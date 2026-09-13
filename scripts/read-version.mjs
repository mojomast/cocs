import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function footerVersion(html) {
  const match = html.match(/<div className="title-footer"><span>(v\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const html = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
    const version = footerVersion(html);
    if (!version) {
      console.error('Release version footer not found in app/page.tsx');
      process.exitCode = 1;
    } else {
      console.log(version);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
