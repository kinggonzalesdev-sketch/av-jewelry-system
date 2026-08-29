package com.mineflow.capture.data

import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.Inflater

/**
 * Test-only helpers to load the REAL pin fixtures (the PNGs under test resources pin-fixtures) into the
 * pure ArgbImage the detector uses. Android's unit-test classpath shadows the JDK desktop classes, so
 * javax.imageio and java.awt are NOT available here; instead this includes a minimal 8-bit PNG decoder
 * built on java.util.zip.Inflater (which IS available in Android unit tests) — no ImageIO, no new
 * dependency. Supports the fixtures' format: 8-bit, colour type 2 (RGB) / 6 (RGBA), non-interlaced.
 */
internal object PinFixtures {

    fun load(name: String): ArgbImage {
        val bytes = PinFixtures::class.java.getResourceAsStream("/pin-fixtures/$name")
            ?.use { it.readBytes() }
            ?: error("fixture not found on test classpath: /pin-fixtures/$name")
        return decodePng(bytes)
    }

    private fun be32(b: ByteArray, p: Int): Int =
        ((b[p].toInt() and 0xFF) shl 24) or ((b[p + 1].toInt() and 0xFF) shl 16) or
            ((b[p + 2].toInt() and 0xFF) shl 8) or (b[p + 3].toInt() and 0xFF)

    private fun paeth(a: Int, b: Int, c: Int): Int {
        val p = a + b - c
        val pa = Math.abs(p - a); val pb = Math.abs(p - b); val pc = Math.abs(p - c)
        return if (pa <= pb && pa <= pc) a else if (pb <= pc) b else c
    }

    /** Minimal PNG decoder: 8-bit, non-interlaced, RGB(2)/RGBA(6). Returns 0xAARRGGBB pixels. */
    fun decodePng(bytes: ByteArray): ArgbImage {
        require(bytes.size > 8 && (bytes[1].toInt() and 0xFF) == 0x50) { "not a PNG" } // 'P'
        var width = 0; var height = 0; var bitDepth = 0; var colorType = 0
        val idat = ByteArrayOutputStream()
        var pos = 8
        while (pos + 8 <= bytes.size) {
            val len = be32(bytes, pos)
            val type = String(bytes, pos + 4, 4, Charsets.US_ASCII)
            val dataStart = pos + 8
            when (type) {
                "IHDR" -> {
                    width = be32(bytes, dataStart); height = be32(bytes, dataStart + 4)
                    bitDepth = bytes[dataStart + 8].toInt() and 0xFF
                    colorType = bytes[dataStart + 9].toInt() and 0xFF
                }
                "IDAT" -> idat.write(bytes, dataStart, len)
                "IEND" -> break
            }
            pos = dataStart + len + 4 // data + CRC
        }
        require(bitDepth == 8) { "only 8-bit PNG supported (was $bitDepth)" }
        val ch = when (colorType) { 2 -> 3; 6 -> 4; else -> error("unsupported PNG colorType $colorType") }

        val inflater = Inflater()
        inflater.setInput(idat.toByteArray())
        val stride = width * ch
        val raw = ByteArray((stride + 1) * height)
        var off = 0
        while (!inflater.finished() && off < raw.size) {
            val n = inflater.inflate(raw, off, raw.size - off)
            if (n == 0) break
            off += n
        }
        inflater.end()

        val out = ByteArray(stride * height)
        for (y in 0 until height) {
            val filter = raw[y * (stride + 1)].toInt() and 0xFF
            val rowIn = y * (stride + 1) + 1
            val rowOut = y * stride
            for (x in 0 until stride) {
                val cur = raw[rowIn + x].toInt() and 0xFF
                val a = if (x >= ch) out[rowOut + x - ch].toInt() and 0xFF else 0
                val b = if (y > 0) out[rowOut - stride + x].toInt() and 0xFF else 0
                val c = if (x >= ch && y > 0) out[rowOut - stride + x - ch].toInt() and 0xFF else 0
                val v = when (filter) {
                    0 -> cur
                    1 -> cur + a
                    2 -> cur + b
                    3 -> cur + ((a + b) ushr 1)
                    4 -> cur + paeth(a, b, c)
                    else -> cur
                }
                out[rowOut + x] = (v and 0xFF).toByte()
            }
        }

        val px = IntArray(width * height)
        for (i in 0 until width * height) {
            val base = i * ch
            val r = out[base].toInt() and 0xFF
            val g = out[base + 1].toInt() and 0xFF
            val b = out[base + 2].toInt() and 0xFF
            val al = if (ch == 4) out[base + 3].toInt() and 0xFF else 255
            px[i] = (al shl 24) or (r shl 16) or (g shl 8) or b
        }
        return ArgbImage(px, width, height)
    }

    /** A copy of `img` with `box` overwritten by opaque mid-grey — masks out the pin badge. */
    fun maskBox(img: ArgbImage, box: Box, argb: Int = 0xFF808080.toInt()): ArgbImage {
        val out = img.pixels.copyOf()
        val l = maxOf(0, box.left); val t = maxOf(0, box.top)
        val r = minOf(img.width, box.right); val b = minOf(img.height, box.bottom)
        for (y in t until b) for (x in l until r) out[y * img.width + x] = argb
        return ArgbImage(out, img.width, img.height)
    }

    /** Nearest-neighbour rescale by `factor` (device-density / scale tolerance). */
    fun rescale(img: ArgbImage, factor: Double): ArgbImage {
        val w = maxOf(1, Math.round(img.width * factor).toInt())
        val h = maxOf(1, Math.round(img.height * factor).toInt())
        val out = IntArray(w * h)
        for (y in 0 until h) {
            val sy = Math.min((y / factor).toInt(), img.height - 1)
            for (x in 0 until w) {
                val sx = Math.min((x / factor).toInt(), img.width - 1)
                out[y * w + x] = img.pixels[sy * img.width + sx]
            }
        }
        return ArgbImage(out, w, h)
    }

    /** A 3×3 box blur — a pure-JVM stand-in for anti-aliasing / mild compression softening. */
    fun softBlur(img: ArgbImage): ArgbImage {
        val out = IntArray(img.width * img.height)
        for (y in 0 until img.height) for (x in 0 until img.width) {
            var ar = 0; var ag = 0; var ab = 0; var aa = 0; var cnt = 0
            for (dy in -1..1) for (dx in -1..1) {
                val nx = x + dx; val ny = y + dy
                if (nx in 0 until img.width && ny in 0 until img.height) {
                    val p = img.pixels[ny * img.width + nx]
                    aa += (p ushr 24) and 0xFF; ar += (p ushr 16) and 0xFF
                    ag += (p ushr 8) and 0xFF; ab += p and 0xFF; cnt++
                }
            }
            out[y * img.width + x] =
                ((aa / cnt) shl 24) or ((ar / cnt) shl 16) or ((ag / cnt) shl 8) or (ab / cnt)
        }
        return ArgbImage(out, img.width, img.height)
    }

    /** Copy `srcBox` from `src` onto a copy of `dst` at (dstX,dstY) — e.g. paste a pin onto another
     *  avatar to build a two-pin fixture. Returns the new image. */
    fun pasteRegion(dst: ArgbImage, src: ArgbImage, srcBox: Box, dstX: Int, dstY: Int): ArgbImage {
        val out = dst.pixels.copyOf()
        val w = srcBox.right - srcBox.left
        val h = srcBox.bottom - srcBox.top
        for (y in 0 until h) {
            val ty = dstY + y
            if (ty < 0 || ty >= dst.height) continue
            for (x in 0 until w) {
                val tx = dstX + x
                if (tx < 0 || tx >= dst.width) continue
                out[ty * dst.width + tx] = src.pixels[(srcBox.top + y) * src.width + (srcBox.left + x)]
            }
        }
        return ArgbImage(out, dst.width, dst.height)
    }

    /** Write a diagnostic report to <module>/build/<name>, returning the absolute path. */
    fun writeReport(name: String, text: String): String {
        val dir = File(System.getProperty("user.dir"), "build")
        dir.mkdirs()
        val f = File(dir, name)
        f.writeText("user.dir=" + System.getProperty("user.dir") + "\n\n" + text)
        return f.absolutePath
    }
}
