# Lobby transport probe

A finished, time-boxed experiment, not product code. It asked how a browser on an https page reaches a world server that a player runs on their own machine, with no TLS certificate and behind a home NAT. Its answer is what the game uses now ([Playing together](../../guide/multiplayer.md)).

## What it proved

- **WebRTC data channels, signalled by a master, work across a real NAT.** A Mac on a home NAT and a GitHub Actions runner, neither reachable from outside, connected every time with Node, Chromium and Safari clients, through a server-reflexive pair. No port was forwarded.
- **WebTransport was ruled out for play.** It needs the host's UDP port reachable, and unsolicited UDP to the Mac was dropped. Chromium also gates WebTransport to LAN and loopback addresses behind a permission.
- **Whole-offer signalling needs a gathering deadline.** Browsers and libdatachannel don't reliably finish gathering, so each end stops at a deadline. The door and the page share that rule in `engine/page/wire.ts`.
- **libdatachannel needs STUN servers as IPv4 literals.** With a hostname and no IPv6 route, gathering never ends.
- **An https page reaching `127.0.0.1` on the visitor's machine**: Chromium allows it only after the visitor grants local network access; Safari refuses `fetch` outright but allows WebTransport by certificate hash.

The measurements, versions and what was not verified are in the [lobby-transport skill](../../.agents/skills/lobby-transport/SKILL.md). Raw results are in `results/`.

## Still used

`master/test/e2e.mjs` borrows this folder's `node_modules` (node-datachannel and Playwright), `lib/rtc-load.mjs` (WebRTC on the W3C API, the same code in a browser and in Node) and `lib/stun.mjs`. Run `npm ci` here before it. Nothing else in the product imports from here.

## Files

| File | What it is |
| --- | --- |
| `server.mjs` | The page's origin, a stand-in master (a held-open socket for hosts, one request per join), the results sink, and a relay to the issue mailbox. 127.0.0.1:5980. |
| `host.mjs` | A stand-in dedicated server: a WebRTC host (node-datachannel, ICE ports 5983 to 5987) and WebTransport on UDP 5981 with a 13-day certificate hash |
| `helper.mjs` | Test 4: plain HTTP on 127.0.0.1 and ::1 port 5982 (CORS and private network headers), and WebTransport on 127.0.0.1:5988 |
| `web/index.html` | The page: `?t=rtc`, `?t=wt` or `?t=local`. It reports to `/result/<name>`. |
| `lib/rtc-load.mjs` | WebRTC client and host on the W3C API, and the load |
| `web/wt-load.mjs` | The WebTransport client's load |
| `nat-peer.mjs` | Test 2: NAT shape, a raw UDP punch, a WebTransport attempt, and WebRTC both ways through a GitHub issue used as a mailbox |
| `far-end.workflow.yml` | The runner's side of test 2, and `loads.mjs` on Windows x64 and Linux arm64 |
| `stun-check.mjs`, `loads.mjs` | The NAT type from one socket; whether the prebuilt addon loads on a platform |
| `drive.mjs`, `safari.mjs` | Open the page in Playwright Chromium (or Chrome), or in this Mac's real Safari |

The load on every transport: 10 requests and replies, 20 MB down at full speed, 20 MB down to a reader that takes 2 MB/s, then 20 small messages a second up for a minute (reliable and unreliable), each echoed.

## Run it again

```sh
cd probes/lobby-transport
npm ci && npx playwright install chromium

# Tests 1 and 3: an https page reaching a host with no certificate
node server.mjs &                                   # 127.0.0.1:5980
tailscale serve --bg --https=10980 http://127.0.0.1:5980
ORIGIN=https://<this-mac>.<tailnet>.ts.net:10980    # never commit the name
node host.mjs $ORIGIN mac1 &                        # lists itself as lobby mac1
node drive.mjs "$ORIGIN/?t=rtc&lobby=mac1&up=60" t1-rtc-chromium
node drive.mjs "$ORIGIN/?t=wt&lobby=mac1&up=60"  t1-wt-chromium
node safari.mjs "$ORIGIN/?t=rtc&lobby=mac1&up=60" t1-rtc-safari
node safari.mjs "$ORIGIN/?t=wt&lobby=mac1&up=60"  t1-wt-safari
# Chromium as if the origin were public (the tailnet address is in 100.64/10):
ORIGIN_IP=<tailnet ip> node drive.mjs "$ORIGIN/?t=wt&lobby=mac1&up=2" lan-wt-public --public-origin

# Test 4: an https page reaching http://127.0.0.1 on the visitor's machine
node helper.mjs &                                   # prints the WebTransport hash
ORIGIN_IP=<tailnet ip> node drive.mjs "$ORIGIN/?t=local#helperwt=<hash>" local-chromium-public --public-origin
ORIGIN_IP=<tailnet ip> node drive.mjs "$ORIGIN/?t=local#helperwt=<hash>" local-chromium-public-grant --public-origin --grant
node safari.mjs "$ORIGIN/?t=local#helperwt=<hash>" local-safari

# Test 2: across a real NAT. The far end is far-end.workflow.yml: copy it to
# .github/workflows/ on a branch (never main). Make a throwaway issue as the mailbox
# and put its number in the workflow's MAILBOX_ISSUE.
printf 'r1\n\n\n' > run.txt    # run id, PHASES (empty = all), SCTP_BUF (empty = default)
git commit -am "[#526] run r1" && git push git@github.com:voxelwright/voxelwright.git HEAD   # over SSH: the gh token cannot push workflows
MAILBOX_ISSUE=<n> SAY_BYE=0 node nat-peer.mjs mac r1          # STUN, UDP, WebTransport, A, then B from Node
MAILBOX_ISSUE=<n> node server.mjs &                             # the relay for browsers
node drive.mjs  "$ORIGIN/?t=rtc&relay=r1&sid=B-chromium&up=60" nat-B-chromium
node safari.mjs "$ORIGIN/?t=rtc&relay=r1&sid=B-safari&up=60"   nat-B-safari
node -e "import('./lib/mailbox.mjs').then(m=>m.mailbox({repo:'voxelwright/voxelwright',issue:<n>,me:'mac',run:'r1'}).post('bye','B',{}))"
# Afterwards: delete the comments (mailbox(...).clear()) and close the issue.
```

Ports: 5980 (page, TCP), 5981 (WebTransport, UDP), 5982 (helper, TCP), 5983 to 5987 (ICE, UDP), 5988 (helper WebTransport, UDP). Turn the serve off with `tailscale serve --https=10980 off`. Never run `tailscale serve reset`: other work uses it.

**The SDP in the mailbox carries the Mac's public address.** Nothing here prints it: results, logs and the runner's log carry candidate types only. Delete the comments when a run is done.
