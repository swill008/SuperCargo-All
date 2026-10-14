# Cuts a real Game.log down to the lines Other mode reads and strips personal data, so it can be checked in.
# Usage: python -I test/replay/make_fixture.py <Game.log> [...] [--out test/replay/fixtures]
# Player handle -> PLAYER, own player id -> 1, other players' ids -> OWNER-n (same id, same n),
# network fields (nickname, playerGEID, addresses, session, node) removed. Mission ids are kept.
import os
import re
import sys

KEEP = re.compile(
    r'Contract Accepted|New Objective|Objective Complete|Objective Withdrawn|Contract Not Accepted|Contract Complete'
    r'|<EndMission>|<MissionShared>|CreateMarker|requested disconnect|<SystemQuit>|Log started on'
)
STAMP = re.compile(r'^<[^>]+>')
DROP_FIELDS = re.compile(r'\s(?:nickname="[^"]*"|playerGEID=\d+|remoteAddr=\S+|localAddr=\S+|session=\S+|node_id=\S+)')
IPV4 = re.compile(r'\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b')


def handles_and_ids(lines):
    """Own handle(s)/id(s) from EndMission and disconnect lines; other players' ids from MissionShared."""
    handles, own, others = set(), set(), []
    for l in lines:
        for m in re.finditer(r'Player\[([^\]]+)\] PlayerId\[(\d+)\]', l):
            handles.add(m[1])
            own.add(m[2])
        m = re.search(r'nickname="([^"]+)"', l)
        if m:
            handles.add(m[1])
        m = re.search(r'playerGEID=(\d+)', l)
        if m:
            own.add(m[1])
        m = re.search(r'ownerId\[(\d+)\]', l)
        if m and m[1] not in others:
            others.append(m[1])
    return handles, own, others


def clean(lines):
    handles, own, others = handles_and_ids(lines)
    owner = {pid: f'OWNER-{i + 1}' for i, pid in enumerate(p for p in others if p not in own)}
    kept, open_quote = [], False
    for l in lines:
        # a notification whose text ends in a newline continues on the next line(s) until the closing quote
        if open_quote:
            kept.append(l)
            open_quote = l.count('"') % 2 == 0
            continue
        if not KEEP.search(l) or '<UpdateNotificationItem>' in l:  # queue bookkeeping, repeats every notification
            continue
        kept.append(l)
        body = STAMP.sub('', l)
        open_quote = body.count('"') % 2 == 1
    out = []
    for l in kept:
        l = re.sub(r'Player\[[^\]]+\] PlayerId\[\d+\]', 'Player[PLAYER] PlayerId[1]', l)
        l = re.sub(r'ownerId\[(\d+)\]', lambda m: f'ownerId[{owner.get(m[1], "1")}]', l)
        l = DROP_FIELDS.sub('', l)
        l = IPV4.sub('0.0.0.0', l)
        for pid in own:
            l = l.replace(pid, '1')
        for pid, ph in owner.items():
            l = l.replace(pid, ph)
        for h in handles:
            l = re.sub(re.escape(h), 'PLAYER', l, flags=re.I)
        out.append(l)
    return out


def fixture_name(src):
    base = os.path.basename(src)
    base = re.sub(r'^[0-9a-f]{8}-', '', base)  # upload prefix
    return re.sub(r'[^\w.-]+', '_', base)


def main(argv):
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
    if '--out' in argv:
        i = argv.index('--out')
        out_dir = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    os.makedirs(out_dir, exist_ok=True)
    for src in argv:
        with open(src, encoding='utf-8', errors='replace') as f:
            lines = f.read().splitlines()
        out = clean(lines)
        dest = os.path.join(out_dir, fixture_name(src))
        with open(dest, 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(out) + '\n')
        print(f'{dest}: {len(out)} of {len(lines)} lines')


if __name__ == '__main__':
    main(sys.argv[1:])
