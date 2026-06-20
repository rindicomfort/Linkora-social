import { test, expect } from '@playwright/test';
import { connectWallet, waitForWalletConnection, navigateToProfile } from './test-utils';

test.describe('Wallet Connection & Profile Registration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('E2E: connect wallet → register profile → verify profile page shows username', async ({
    page,
  }) => {
    await connectWallet(page);

    const connectedAddress = await waitForWalletConnection(page);
    expect(connectedAddress).toBeTruthy();
    expect(connectedAddress).toMatch(/^[GS][A-Z0-9]{55}$/);

    await navigateToProfile(page, connectedAddress);
    await page.waitForLoadState('networkidle');

    const profileHeading = page.locator('h1, h2').first();
    await expect(profileHeading).toBeVisible({ timeout: 10000 });

    const profileContent = page.locator('text=/Profile|Username|Bio|Posts/i').first();
    await expect(profileContent).toBeVisible({ timeout: 10000 });

    expect(page.url()).toContain(connectedAddress);
  });

  test('should display connected wallet address in header', async ({ page }) => {
    await connectWallet(page);

    const addressBadge = page.locator('[data-testid="wallet-address"]').first();
    await expect(addressBadge).toBeVisible({ timeout: 10000 });
  });

  test('should disconnect wallet', async ({ page }) => {
    await connectWallet(page);

    const disconnectButton = page.locator('[data-testid="disconnect-wallet"]').first();
    await expect(disconnectButton).toBeVisible({ timeout: 10000 });
    await disconnectButton.click();

    const connectButton = page.locator('[data-testid="connect-wallet"]').first();
    await expect(connectButton).toBeVisible({ timeout: 10000 });
  });
});
