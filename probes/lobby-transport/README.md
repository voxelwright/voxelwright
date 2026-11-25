# Lobby transport probe (#526)

A time-boxed experiment, not product code. It decides how a browser on an https
page (zahynailo.dev) reaches a world server a player runs on their own machine,
with no TLS certificate and behind a home NAT. Findings and versions are in
`.agents/skills/lobby-transport/SKILL.md`; raw results are in `results/`.

| File | What it is |
| --- | --- |
| `server.mjs` | the page's origin, a stand-in master (held-open socket for hosts, one-request join), the results sink, and a relay to the issue mailbox; 127.0.0.1:5980 |
| `host.mjs` | a stand-in dedicated server: WebRTC host (node-datachannel, ICE ports 5983-5987) and WebTransport on UDP 5981 with a 13-day certificate hash |
| `helper.mjs` | test 4: plain http on 127.0.0.1 and ::1 port 5982 (CORS and PNA headers), and WebTransport on 127.0.0.1:5988 |
| `web/index.html` | the page: `?t=rtc`, `?t=wt` or `?t=local`; reports to `/result/<name>` |
| `lib/rtc-load.mjs` | WebRTC client and host on the W3C API (browser and node-datachannel's polyfill) and the load |
| `web/wt-load.mjs` | the WebTransport client load |
| `nat-peer.mjs` | test 2: STUN shape, raw UDP punch, WebTransport attempt, WebRTC both ways through a GitHub issue mailbox |
| `far-end.workflow.yml` | the runner's side of test 2, and `loads.mjs` on Windows x64 and Linux arm64 |
| `stun-check.mjs`, `loads.mjs` | NAT type from one socket; does the prebuilt addon load on this platform |
| `drive.mjs`, `safari.mjs` | open the page in Playwright Chromium (or Chrome) or in this Mac's real Safari |

The load, on every transport: 10 requests and replies, 20 MB down at full speed,
20 MB down to a reader that takes 2 MB/s, then 20 small messages a second up for a
minute (reliable and unreliable), each echoed.

## Run it

```sh
cd probes/lobby-transport
npm ci && npx playwright install chromium

# Test 1 and 3: an https page reaching a host with no certificate
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
git commit -am "[#526] run r1" && git push git@github.com:the private source repository.git HEAD   # push over SSH: the gh token cannot push workflows
MAILBOX_ISSUE=<n> SAY_BYE=0 node nat-peer.mjs mac r1          # STUN, UDP, WebTransport, A, then B from Node
MAILBOX_ISSUE=<n> node server.mjs &                             # the relay for browsers
node drive.mjs  "$ORIGIN/?t=rtc&relay=r1&sid=B-chromium&up=60" nat-B-chromium
node safari.mjs "$ORIGIN/?t=rtc&relay=r1&sid=B-safari&up=60"   nat-B-safari
node -e "import('./lib/mailbox.mjs').then(m=>m.mailbox({repo:'the private source repository',issue:<n>,me:'mac',run:'r1'}).post('bye','B',{}))"
# Afterwards: delete the comments (mailbox(...).clear()) and close the issue.
```

Ports: 5980 (page, TCP), 5981 (WebTransport, UDP), 5982 (helper, TCP), 5983-5987
(ICE, UDP), 5988 (helper WebTransport, UDP). Turn the serve off with
`tailscale serve --https=10980 off`; never `tailscale serve reset`, other lanes use it.

The SDP in the mailbox carries the Mac's public address. Nothing here prints it:
results, logs and the runner's log carry candidate types only. The comments are
deleted when a run is done.

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"probes/lobby-transport/server.mjs":"a7016a73ad3a812dc388142ae3358756","probes/lobby-transport/helper.mjs":"6606a23ce2536c2076057694d3410390","probes/lobby-transport/host.mjs":"9dc6fdc9a407627fcf39666c87fd096b"} -->
