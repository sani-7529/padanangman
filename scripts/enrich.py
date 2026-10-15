"""Fill lat/lng, distSea, distStore in data/stays.json via Kakao Local REST API.
Reads KAKAO_REST_KEY from .env (never committed). Run: python scripts/enrich.py"""
import json, os, re, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = re.search(r'KAKAO_REST_KEY=(\S+)', open(os.path.join(ROOT, '.env')).read()).group(1)
P = os.path.join(ROOT, 'data', 'stays.json')
CHAIN = re.compile(r'CU|GS25|세븐일레븐|이마트24|미니스톱')

def api(path, **q):
    r = urllib.request.Request('https://dapi.kakao.com/v2/local/' + path + '?' + urllib.parse.urlencode(q),
                               headers={'Authorization': 'KakaoAK ' + KEY})
    return json.load(urllib.request.urlopen(r))['documents']

def geocode(addr):
    a = addr.replace('강원특별자치도', '강원도')
    for q in (a, re.sub(r'^\S+\s', '', a)):
        d = api('search/address.json', query=q)
        if d:
            return float(d[0]['y']), float(d[0]['x'])
    return None

d = json.load(open(P, encoding='utf-8'))
for s in d['stays']:
    addr = s.get('address')
    if not addr:
        print('skip (no address):', s['name']); continue
    if s['lat'] is None:
        pos = geocode(addr)
        if not pos:
            print('NO GEOCODE:', s['name'], addr); continue
        s['lat'], s['lng'] = pos
    y, x = s['lat'], s['lng']
    beaches = [b for b in api('search/keyword.json', query='해수욕장', x=x, y=y, radius=20000, sort='distance', size=15)
               if re.search(r'(해수욕장|해변)$', b['place_name'])]
    if beaches:
        s['distSea'] = int(beaches[0]['distance']); s['nearestBeach'] = beaches[0]['place_name']
    stores = [p for p in api('search/category.json', category_group_code='CS2', x=x, y=y, radius=20000, sort='distance', size=15)
              if CHAIN.search(p['place_name'])]
    if stores:
        s['distStore'] = int(stores[0]['distance']); s['nearestStore'] = stores[0]['place_name']
    print(s['name'], s['lat'], s['lng'], 'sea', s.get('distSea'), s.get('nearestBeach'), 'store', s.get('distStore'), s.get('nearestStore'))
json.dump(d, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# activities: coordinates only
AP = os.path.join(ROOT, 'data', 'activities.json')
a = json.load(open(AP, encoding='utf-8'))
for x in a['activities']:
    if x['lat'] is None:
        pos = geocode(x['address'])
        if pos:
            x['lat'], x['lng'] = pos
        else:
            print('NO GEOCODE:', x['name'], x['address'])
    print(x['name'], x['lat'], x['lng'])
json.dump(a, open(AP, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
