import {buildIdentity} from '../../../game/build-identity.mjs';

export const dynamic = 'force-dynamic';

// The running build's identity. The client polls this and offers a reload when
// the deployed version is newer than the one baked into the open tab, which
// catches a stale tab even when the document cache headers are ignored. The
// deployment verifier compares the exact commit/buildId/protocol fields, so
// `version` is kept beside `release` for older readers.
export function GET() {
  const {service, release, codename, commit, buildId, protocol} = buildIdentity(process.env, 'token-arena-web');
  return Response.json(
    {version: release, release, codename, commit, buildId, protocol, service},
    {headers: {'Cache-Control': 'no-store'}},
  );
}
