"""Seed / replace / inspect the LOCAL dev record storage for the snapshot lifecycle test.

Local development only. It edits the dev Durable Object's SQLite file under
.wrangler/state, with SYNTHETIC data (tests/fixtures/synthetic/ssd.json). It makes no
network request, never touches production, and refuses to write while any process
has the database open (stop the dev server / test run first).

  python3 -I tests/integration/local-cache.py status
  python3 -I tests/integration/local-cache.py seed      # fresh cache for "WD Black SN850X": groups 2TB + 1TB
  python3 -I tests/integration/local-cache.py replace   # fresh cache where the 2TB group is gone and a look-alike title appears
  python3 -I tests/integration/local-cache.py clear     # remove that cache row

Only the cache row for the synthetic query is ever written. The real AirPods row from the live validation is left alone.
"""
import glob, json, os, random, sqlite3, string, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QUERY = 'WD Black SN850X'
KEY = 'us|wd black sn850x'  # cacheKey('us', QUERY): see src/server/pricing/normalize.ts
TTL_MS = 12 * 3600 * 1000


def db_path():
    files = [f for f in glob.glob(os.path.join(ROOT, '.wrangler/state/v3/do/dealproof-review-AppRecordRoom/*.sqlite')) if not f.endswith('metadata.sqlite')]
    if len(files) != 1:
        sys.exit(f'expected exactly one record-room database, found {len(files)}')
    return files[0]


def refuse_if_open(path):
    out = subprocess.run(['lsof', '-t', path], capture_output=True, text=True).stdout.split()
    if out:
        sys.exit(f'refusing: process(es) {out} have the database open. Stop the dev server / test run first.')


def fixture():
    return json.load(open(os.path.join(ROOT, 'tests/fixtures/synthetic/ssd.json')))


def payload(mode):
    doc = fixture()
    cands = doc['candidates']
    if mode == 'seed':
        return {'candidates': cands, 'source': doc['source']}
    a, b = cands[0], cands[1]
    look = json.loads(json.dumps(a))
    look['pid'] = 9199
    look['productRef'] = {'id': '9199', 'idType': 'pricesapi', 'market': 'us'}
    look['title'] = 'WD_BLACK 2TB SN850X NVMe Internal Gaming SSD Heatsink Edition'
    for i, o in enumerate(look['offers'][:3]):
        o['title'] = f'LOOKALIKE WD_BLACK SN850X 2TB Heatsink Edition {i}'
        o['price'] = 100.0 + i
    look['offers'] = look['offers'][:3]
    look['offerCount'] = 3
    return {'candidates': [look, b], 'source': {**doc['source'], 'scrapedAt': '2026-11-21T23:00:00.000Z'}}


def write(mode):
    path = db_path()
    refuse_if_open(path)
    now = int(time.time() * 1000)
    iso = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(now / 1000))
    c = sqlite3.connect(path)
    c.execute('delete from c_search_cache where col_key = ?', (KEY,))
    if mode != 'clear':
        rid = f"{now}_{''.join(random.choices(string.ascii_lowercase + string.digits, k=6))}"
        c.execute(
            'insert into c_search_cache (_row_id,_created_by,_created_at,_updated_at,col_key,col_market,col_query,col_payload,col_cachedatms,col_expiresatms) values (?,?,?,?,?,?,?,?,?,?)',
            (rid, 'local-integration-seed', iso, iso, KEY, 'us', QUERY, json.dumps(payload(mode)), float(now), float(now + TTL_MS)),
        )
    c.commit()
    c.close()
    print(f'{mode}: done')


def status():
    c = sqlite3.connect('file:' + db_path() + '?mode=ro', uri=True)
    now = time.time() * 1000
    print('search_cache:')
    for key, q, exp, pay in c.execute('select col_key,col_query,col_expiresatms,col_payload from c_search_cache'):
        titles = [x['title'][-28:] for x in json.loads(pay)['candidates']]
        print(f"  {key!r:34} {'fresh' if exp > now else 'EXPIRED'} groups={titles}")
    print('usage_claims:', c.execute('select count(*) from c_usage_claims').fetchone()[0])
    print('saved_products:', c.execute('select count(*) from c_saved_products').fetchone()[0])
    print('saved_snapshots:')
    for sid, uid, ms, pay in c.execute('select col_savedid,col_userid,col_capturedatms,col_payload from c_saved_snapshots'):
        p = json.loads(pay)
        print(f"  saved={sid[:14]}.. owner={uid[:8]}.. captured={time.strftime('%H:%M:%S', time.gmtime(ms / 1000))}Z offers={len(p['offers'])} group={p['candidate']['title'][:50]!r}")
    c.close()


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'status'
    {'status': status}.get(mode, lambda: write(mode) if mode in ('seed', 'replace', 'clear') else sys.exit('usage: status|seed|replace|clear'))()
