# Compares a replayed Game.log (replay.mjs --log) against what the log itself says happened.
# Usage: python test/replay/compare_log.py <Game.log> <replay result .json>
import json,re,sys,collections
log=open(sys.argv[1],encoding='utf-8',errors='replace').read().splitlines()
app=json.load(open(sys.argv[2]))
truth=collections.OrderedDict()
for l in log:
    m=re.search(r'Added notification "Contract Accepted:\s*(.*?)"\s*\[.*?MissionId: \[([^\]]+)\]',l)
    if m: truth.setdefault(m[2],{'title':re.sub(r'<EM4>.*','',m[1]).strip(),'end':None,'objs':[]}); continue
    m=re.search(r'Added notification "New Objective: (.*?): ?"\s*\[.*?MissionId: \[([^\]]+)\]',l)
    if m and m[2] in truth: truth[m[2]]['objs'].append(m[1]); continue
    m=re.search(r'<EndMission>.*MissionId\[([^\]]+)\].*CompletionType\[(\w+)\]',l)
    if m and m[1] in truth: truth[m[1]]['end']=m[2]
jobs={ (j.get('missionId') or j['id']): j for j in app['jobs']}
for h in app['history']:
    j=h.get('job',h); jobs.setdefault(j.get('missionId') or j['id'], j)
mapend={'Complete':'complete','Abandon':'abandoned','Fail':'abandoned',None:'active'}
bad=collections.Counter(); rows=[]
for mid,t in truth.items():
    j=jobs.get(mid)
    want=mapend[t['end']]
    got=j['status'] if j else 'MISSING'
    nsteps=len(j['steps']) if j else 0
    issue=[]
    if got!=want: issue.append(f'status {got}≠{want}')
    if len(t['objs'])!=nsteps: issue.append(f'steps {nsteps}≠objs {len(t["objs"])}')
    for i in issue: bad[i.split(' ')[0]]+=1
    if issue: rows.append(f"{mid[:8]} {t['title'][:45]:45} end={t['end']} | "+'; '.join(issue)+f" | objs={t['objs']} steps={[s.get('label') for s in (j or {}).get('steps',[])]}")
print(f"missions={len(truth)} app_jobs={len(jobs)} with_issues={len(rows)} {dict(bad)}")
for r in rows[:25]: print(' ',r[:330])
