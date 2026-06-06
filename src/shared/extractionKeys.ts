export interface Keyable {
  box?: string;
  label: string;
}

export const fieldKey = (f: Keyable): string => `${f.box ?? ""}\x00${f.label}`;

export const META_KEYS = {
  payerName: "\x00meta\x00payer.name",
  payerEin: "\x00meta\x00payer.ein",
  recipientName: "\x00meta\x00recipient.name",
  recipientSsn: "\x00meta\x00recipient.ssn_last4",
  taxYear: "\x00meta\x00taxYear",
} as const;
