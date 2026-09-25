import { LEGAL_BUSINESS, telHref } from '@/lib/legal/legal-info';

/**
 * The confirmed business identity, rendered the same way on every legal page. Plain list markup
 * so it inherits the LegalArticle typography. The email may wrap at any character so a narrow
 * phone (360 px) never scrolls sideways.
 */
export function LegalBusinessDetails() {
  return (
    <ul data-testid="legal-business-details">
      <li>
        <strong>Registered business name:</strong> {LEGAL_BUSINESS.registeredName}
      </li>
      <li>
        <strong>Trading / website name:</strong> {LEGAL_BUSINESS.brand}
      </li>
      <li>
        <strong>DTI Registration No.:</strong> {LEGAL_BUSINESS.dtiRegistrationNumber}
      </li>
      <li>
        <strong>BIR TIN:</strong> {LEGAL_BUSINESS.tin}
      </li>
      <li>
        <strong>Business address:</strong> {LEGAL_BUSINESS.address}
      </li>
      <li>
        <strong>Contact numbers:</strong>{' '}
        {LEGAL_BUSINESS.phones.map((phone, i) => (
          <span key={phone}>
            {i > 0 ? ' · ' : null}
            <a className="whitespace-nowrap" href={telHref(phone)}>
              {phone}
            </a>
          </span>
        ))}
      </li>
      <li>
        <strong>Official email:</strong>{' '}
        <a className="[overflow-wrap:anywhere]" href={`mailto:${LEGAL_BUSINESS.email}`}>
          {LEGAL_BUSINESS.email}
        </a>
      </li>
      <li>
        <strong>Business and customer support hours:</strong> {LEGAL_BUSINESS.hours}
      </li>
    </ul>
  );
}
