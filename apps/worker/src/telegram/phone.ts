/** `+84912345678` → `+84•••••••78`: enough to recognize the number, not to use it. */
export function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.length <= 5) {
    return '•'.repeat(phoneNumber.length);
  }
  return `${phoneNumber.slice(0, 3)}${'•'.repeat(phoneNumber.length - 5)}${phoneNumber.slice(-2)}`;
}
