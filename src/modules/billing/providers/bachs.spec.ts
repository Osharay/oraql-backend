import { bachsPaid } from './bachs';

describe('bachsPaid', () => {
  it('needs real payment, not just a finished checkout', () => {
    // A checkout that ended without the money (an expired bank transfer, a closed page).
    expect(bachsPaid({ status: 'completed' })).toBe(false);
    expect(bachsPaid({ status: 'completed', payment_status: 'unpaid' })).toBe(false);
    expect(bachsPaid({ status: 'expired' })).toBe(false);
    expect(bachsPaid({ status: 'open', charge: { status: 'pending' } })).toBe(false);
    // Paid.
    expect(bachsPaid({ status: 'completed', payment_status: 'paid' })).toBe(true);
    expect(bachsPaid({ status: 'completed', charge: { status: 'succeeded' } })).toBe(true);
  });
});
