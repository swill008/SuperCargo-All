# Compares a replayed Game.log (replay.mjs --log) against what the log itself says happened, per the
# Job rules in src/other/STANDALONE.md. Exit 1 when any mission differs.
# Usage: python test/replay/compare_log.py <Game.log> <replay result .json>
#
# Truth per mission, walking the log in order:
#   accept -> active (a re-share re-accept reactivates, rule 4); EndMission -> complete / abandoned (latest wins,
#   rule 3); "Player requested disconnect" or SystemQuit (console command or closing the app) -> every active one
#   abandoned (rule 5). Nothing else ends a job (rule 6).
# Steps: unique New Objective texts (counts ignored), minus withdrawn ones; the app may merge a
#   Collect/Pick up with its Deliver, and its withdrawn steps are not counted.
# Scan mode (start-up scan of a whole log): only missions with an accept after the watermark ("since", none =
#   all) are checked, and a mission that ended may be absent unless it was accepted again after an ending.
import collections
import json
import re
import sys

ACCEPT = re.compile(r'Added notification "Contract Accepted:\s*(.*?)"\s*\[.*?MissionId: \[([^\]]+)\]')
OBJ = re.compile(r'Added notification "New Objective: (.*?):? ?"\s*\[.*?MissionId: \[([^\]]+)\]', re.S)
WITHDRAWN = re.compile(r'Added notification "Objective Withdrawn: (.*?):? ?"\s*\[.*?MissionId: \[([^\]]+)\]', re.S)
END = re.compile(r'<EndMission>.*MissionId\[([^\]]+)\].*CompletionType\[(\w+)\]')
DROP = re.compile(r'<Channel Disconnected>.*Player requested disconnect')
QUIT = re.compile(r'<SystemQuit>.*(Quit via console command|User closed the application)')
STAMP = re.compile(r'^<([^>]+)>')
ENDING = {'Complete': 'complete'}  # Fail, Abandon and anything else count as abandoned (rule 2)
COLLECT = re.compile(r'^(collect|pick ?up|retrieve)\b', re.I)


def records(path):
    """Log lines with multi-line notifications joined (Objective Complete text ends in a newline)."""
    out, cur = [], None
    for line in open(path, encoding='utf-8', errors='replace').read().splitlines():
        if cur is not None:
            cur += '\n' + STAMP.sub('', line)
            if line.count('"') % 2 == 1:
                out.append(cur)
                cur = None
            continue
        if STAMP.sub('', line).count('"') % 2 == 1:
            cur = line
        else:
            out.append(line)
    if cur is not None:
        out.append(cur)
    return out


def norm(text):
    return re.sub(r'\d+\s*/\s*(\d+)', r'N/\1', text.strip()).lower()


def truth(path):
    t = collections.OrderedDict()
    for r in records(path):
        at = (STAMP.match(r) or [None, ''])[1]
        m = ACCEPT.search(r)
        if m:
            mid = m[2]
            e = t.setdefault(mid, {'title': re.sub(r'<EM4>.*', '', m[1]).strip(), 'status': None, 'accepts': [], 'reaccepted': False, 'objs': [], 'withdrawn': set(), 'ends': []})
            if e['status'] in ('complete', 'abandoned'):
                e['reaccepted'] = True
            e['status'] = 'active'
            e['accepts'].append(at)
            continue
        m = OBJ.search(r)
        if m and m[2] in t:
            if norm(m[1]) not in t[m[2]]['objs']:
                t[m[2]]['objs'].append(norm(m[1]))
            continue
        m = WITHDRAWN.search(r)
        if m and m[2] in t:
            t[m[2]]['withdrawn'].add(norm(m[1]))
            continue
        m = END.search(r)
        if m and m[1] in t:
            t[m[1]]['status'] = ENDING.get(m[2], 'abandoned')
            t[m[1]]['ends'].append(m[2])
            continue
        if DROP.search(r) or QUIT.search(r):
            for e in t.values():
                if e['status'] == 'active':
                    e['status'] = 'abandoned'
                    e['ends'].append('quit' if 'SystemQuit' in r else 'disconnect')
    return t


def app_jobs(app):
    jobs = {}
    for j in app.get('jobs', []):
        jobs[j.get('missionId') or j['id']] = j
    for h in app.get('history', []):
        j = h.get('job', h)
        status = j.get('status') or {'completed': 'complete', 'abandoned': 'abandoned'}.get(h.get('outcome'), h.get('outcome'))
        jobs.setdefault(j.get('missionId') or j['id'], {**j, 'status': status})
    return jobs


def main(log_path, result_path):
    app = json.load(open(result_path, encoding='utf-8'))
    mode = app.get('mode', 'live')
    since = app.get('since') or ''
    t = truth(log_path)
    jobs = app_jobs(app)
    bad, rows, checked = collections.Counter(), [], 0
    for mid, e in t.items():
        if mode == 'scan' and since and not any(a > since for a in e['accepts']):
            continue
        checked += 1
        j = jobs.get(mid)
        issue = []
        if j is None:
            if not (mode == 'scan' and e['status'] != 'active' and not e['reaccepted']):
                issue.append(f"missing (want {e['status']})")
        else:
            if j.get('status') != e['status']:
                issue.append(f"status {j.get('status')}≠{e['status']}")
            want = [o for o in e['objs'] if o not in e['withdrawn']]
            lo = len(want) - sum(1 for o in want if COLLECT.match(o))
            steps = [s for s in j.get('steps', []) if not s.get('withdrawn')]
            if not lo <= len(steps) <= len(want):
                issue.append(f'steps {len(steps)}∉[{lo},{len(want)}]')
        for i in issue:
            bad[i.split(' ')[0]] += 1
        if issue:
            labels = [s.get('label') for s in (j or {}).get('steps', [])]
            rows.append(f"{mid[:8]} {e['title'][:45]:45} ends={e['ends']} | " + '; '.join(issue) + f" | objs={e['objs']} steps={labels}")
    print(f"mode={mode} missions={len(t)} checked={checked} app_jobs={len(jobs)} with_issues={len(rows)} {dict(bad)}")
    for r in rows[:25]:
        print(' ', r[:330])
    return 1 if rows else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
