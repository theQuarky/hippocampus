/**
 * macOS notarization helper for electron-builder.
 *
 * Called automatically by electron-builder's afterSign hook when building
 * for macOS. Requires the following environment variables (set as GitHub
 * Actions secrets):
 *   APPLE_ID            — your Apple Developer account email
 *   APPLE_APP_PASSWORD  — app-specific password (appleid.apple.com)
 *   APPLE_TEAM_ID       — 10-character team ID from developer.apple.com
 *
 * electron-builder config in package.json should include:
 *   "afterSign": "installer/scripts/notarize.js"
 */

const { notarize } = require('@electron/notarize');

module.exports = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.warn(
      '⚠ Skipping notarization: APPLE_ID / APPLE_APP_PASSWORD / APPLE_TEAM_ID not set.\n' +
      '  Set these as GitHub Actions secrets for CI builds.'
    );
    return;
  }

  console.log(`  Notarizing ${appName}...`);

  await notarize({
    tool: 'notarytool',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log(`  ✓ Notarization complete`);
};
