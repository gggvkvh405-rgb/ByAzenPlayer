/**
 * Stamps the product icon and Windows version strings into ByAzen.exe.
 * Best-effort: prints why it skipped, never fails the build.
 *   node tools/stamp-exe.cjs <exe> <ico>
 */
const path = require('path');

(async () => {
  const [exe, ico] = process.argv.slice(2);
  if (!exe || !ico) {
    console.log('usage: node tools/stamp-exe.cjs <exe> <ico>');
    process.exit(0);
  }
  let rcedit;
  try {
    rcedit = require('rcedit');
  } catch {
    console.log('rcedit not installed — skipping icon/version stamp');
    process.exit(0);
  }
  try {
    await rcedit(path.resolve(exe), {
      icon: path.resolve(ico),
      'version-string': {
        ProductName: 'ByAzen',
        FileDescription: 'ByAzen — premium desktop music player',
        CompanyName: 'ByAzen',
        LegalCopyright: 'ByAzen',
        OriginalFilename: 'ByAzen.exe',
      },
      'file-version': '1.0.0.0',
      'product-version': '1.0.0',
    });
    console.log('stamped icon + version info into', path.basename(exe));
  } catch (e) {
    console.log('rcedit failed (continuing):', e.message);
  }
  process.exit(0);
})();
