import { test, expect } from '@playwright/test';

test.describe('Plongster Game Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Clear all state and unregister service workers for a clean start
        await page.goto('/');
        await page.evaluate(async () => {
            localStorage.clear();
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const r of regs) await r.unregister();
            const keys = await caches.keys();
            for (const k of keys) await caches.delete(k);
        });
        await page.reload();
        await page.waitForLoadState('networkidle');
    });

    test('welcome screen loads correctly', async ({ page }) => {
        await expect(page.locator('#screen-welcome')).toHaveClass(/active/);
        await expect(page.locator('#screen-welcome h1')).toHaveText('PLONGSTER');
        await expect(page.getByText('Start spill')).toBeVisible();
        await expect(page.getByText('Hurtigstart (2 spillere)')).toBeVisible();
    });

    test('navigate to setup screen', async ({ page }) => {
        await page.getByText('Start spill').click();
        await expect(page.locator('#screen-setup')).toHaveClass(/active/);
        await expect(page.locator('#screen-setup h2')).toHaveText('Spillere');

        // Two default player inputs
        const inputs = page.locator('#player-list .player-name-input');
        await expect(inputs).toHaveCount(2);
    });

    test('add and remove players', async ({ page }) => {
        await page.getByText('Start spill').click();

        // Add a third player
        await page.getByText('+ Legg til spiller').click();
        await expect(page.locator('#player-list .player-name-input')).toHaveCount(3);

        // Remove buttons should now be visible
        const removeButtons = page.locator('.btn-remove-player');
        await expect(removeButtons.first()).toBeVisible();

        // Remove the third player
        await removeButtons.last().click();
        await expect(page.locator('#player-list .player-name-input')).toHaveCount(2);
    });

    test('adjust win count', async ({ page }) => {
        await page.getByText('Start spill').click();

        const winCount = page.locator('#win-count');
        await expect(winCount).toHaveText('10');

        // Decrease
        await page.locator('.stepper button').first().click();
        await expect(winCount).toHaveText('9');

        // Increase
        await page.locator('.stepper button').last().click();
        await expect(winCount).toHaveText('10');
    });

    test('start game with named players', async ({ page }) => {
        await page.getByText('Start spill').click();

        const inputs = page.locator('#player-list .player-name-input');
        await inputs.first().fill('Alice');
        await inputs.last().fill('Bob');

        // Start button
        await page.locator('#screen-setup .btn-primary').click();

        // Should be on game screen
        await expect(page.locator('#screen-game')).toHaveClass(/active/);

        // Pass phone overlay should be visible
        await expect(page.locator('#pass-phone-overlay')).toHaveClass(/active/);
        await expect(page.locator('#pass-phone-name')).toHaveText('Alice');
    });

    test('quick start enters game and shows scores after ready', async ({ page }) => {
        await page.getByText('Hurtigstart (2 spillere)').click();

        // Should be on game screen with pass phone overlay
        await expect(page.locator('#screen-game')).toHaveClass(/active/);
        await expect(page.locator('#pass-phone-overlay')).toHaveClass(/active/);

        // Click ready to proceed — scores rendered during startTurn
        await page.getByText('Jeg er klar!').click();

        // Scores should now show two players
        const scoreChips = page.locator('.score-chip');
        await expect(scoreChips).toHaveCount(2);
    });

    test('player ready dismisses pass phone overlay', async ({ page }) => {
        await page.getByText('Hurtigstart (2 spillere)').click();
        await expect(page.locator('#pass-phone-overlay')).toHaveClass(/active/);

        // Click "Jeg er klar!"
        await page.getByText('Jeg er klar!').click();

        // Overlay should be dismissed
        await expect(page.locator('#pass-phone-overlay')).not.toHaveClass(/active/);

        // Current turn should be visible
        await expect(page.locator('#current-turn')).toBeVisible();

        // Playback controls should be visible
        await expect(page.locator('#playback-controls')).toBeVisible();
    });

    test('game state saves to localStorage on start', async ({ page }) => {
        await page.getByText('Start spill').click();

        const inputs = page.locator('#player-list .player-name-input');
        await inputs.first().fill('Alice');
        await inputs.last().fill('Bob');
        await page.locator('#screen-setup .btn-primary').click();

        // Wait for game screen and pass phone overlay
        await expect(page.locator('#pass-phone-overlay')).toHaveClass(/active/);

        // Verify state is saved — use polling to handle any async timing
        await expect(async () => {
            const hasState = await page.evaluate(() => !!localStorage.getItem('plongster-game'));
            expect(hasState).toBe(true);
        }).toPass({ timeout: 3000 });
    });

    test('player names saved to localStorage', async ({ page }) => {
        await page.getByText('Start spill').click();

        const inputs = page.locator('#player-list .player-name-input');
        await inputs.first().fill('Alice');
        await inputs.last().fill('Bob');
        await page.locator('#screen-setup .btn-primary').click();

        // Wait for game screen
        await expect(page.locator('#screen-game')).toHaveClass(/active/);

        // Check that player names were saved
        const names = await page.evaluate(() => {
            const data = localStorage.getItem('plongster-player-names');
            return data ? JSON.parse(data) : null;
        });
        expect(names).toEqual(['Alice', 'Bob']);
    });

    test('song source badge shows default count', async ({ page }) => {
        await page.getByText('Start spill').click();

        const badge = page.locator('#song-source-badge');
        await expect(badge).toBeVisible();
        // Should show number of songs (e.g., "1212 sanger")
        await expect(badge).toHaveText(/\d+ sanger/);
    });
});
