import { SetMetadata } from '@nestjs/common';

export const NO_PAYWALL_KEY = 'noPaywall';

/**
 * Open to a signed-in user whose trial has ended: their account, signing out,
 * and subscribing. Everything else answers 402 until they pay.
 */
export const NoPaywall = () => SetMetadata(NO_PAYWALL_KEY, true);
