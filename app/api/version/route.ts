import {RELEASE_VERSION} from '../../../game/changelog.mjs';

export const dynamic = 'force-dynamic';

// The running build's release id. The client polls this and offers a reload when
// the deployed version is newer than the one baked into the open tab, which
// catches a stale tab even when the document cache headers are ignored.
export function GET() {
  return Response.json({version: RELEASE_VERSION}, {headers: {'Cache-Control': 'no-store'}});
}
