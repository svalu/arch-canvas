# 2AZ 템플릿(01 뼈대, 02 3티어 웹)에서 AZ C 를 하나 더 붙인 3AZ 템플릿을 만든다.
# 사용: python tools/make_3az.py  →  templates/01b_skeleton_region_vpc_3az.json, 02b_three_tier_web_3az.json
import copy, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = lambda f: os.path.join(ROOT, 'templates', f)


def load(f):
    return json.load(open(T(f), encoding='utf-8'))


def save(f, g):
    with open(T(f), 'w', encoding='utf-8', newline='\n') as fp:
        json.dump(g, fp, ensure_ascii=False, indent=2)
        fp.write('\n')


def add_az_c(g, shift_down=0):
    """az-b 를 통째로 복제해 오른쪽에 az-c 로 붙이고, 담는 상자(VPC·Region·ASG)를 넓힌다."""
    G = {x['id']: x for x in g['groups']}
    a, b = G['az-a'], G['az-b']
    step = b['x'] - a['x']                                    # AZ 간격 (폭 + 틈)
    kids = {x['id'] for x in g['groups'] if x.get('parent') == 'az-b'}
    ren = lambda i: i[:-2] + '-c' if i.endswith('-b') else i.replace('-b', '-c')
    new_groups = []
    c = copy.deepcopy(b); c['id'] = 'az-c'; c['label'] = 'Availability Zone C'; c['x'] = b['x'] + step
    new_groups.append(c)
    for x in g['groups']:
        if x.get('parent') == 'az-b':
            y = copy.deepcopy(x); y['id'] = ren(x['id']); y['parent'] = 'az-c'; new_groups.append(y)
    new_nodes = []
    for n in g['nodes']:
        if n.get('parent') in kids:
            m = copy.deepcopy(n); m['id'] = n['id'].replace('-b', '-c').replace('standby', 'standby-c'); m['parent'] = ren(n['parent']); new_nodes.append(m)
    idmap = {n['id']: m['id'] for n, m in zip([n for n in g['nodes'] if n.get('parent') in kids], new_nodes)}
    # 위쪽에 자리를 만들어야 하면 AZ 들을 내린다
    for az in (a, b, c):
        az['y'] += shift_down
    for k in ('vpc', 'region'):
        G[k]['w'] += step
        G[k]['h'] += shift_down
    if 'asg' in G:
        G['asg']['w'] += step
        G['asg']['y'] += shift_down
    g['groups'] += new_groups
    g['nodes'] += new_nodes
    return idmap, step


# ---- 01b: 뼈대 3AZ ----
g = load('01_skeleton_region_vpc_2az.json')
add_az_c(g)
g['title'] = '뼈대: Region > VPC > AZ 3개'
g['meta'] = {**g['meta'], 'id': 'skeleton-3az', 'name': 'Region · VPC · AZ 3개', 'description': 'AZ마다 Public / Private subnet (3개 AZ)'}
save('01b_skeleton_region_vpc_3az.json', g)

# ---- 02b: 3티어 웹 3AZ ----
g = load('02_three_tier_web.json')
idmap, step = add_az_c(g, shift_down=110)   # ALB 를 AZ 위쪽 빈 줄에 두려고 AZ 를 내린다
vpc = next(x for x in g['groups'] if x['id'] == 'vpc')
mid = vpc['w'] / 2 - 24
for n in g['nodes']:
    if n['id'] == 'igw': n['x'] = round(mid); n['y'] = 20
    if n['id'] == 'alb': n['x'] = round(mid); n['y'] = 120
for n in g['nodes']:
    if n['id'] == idmap.get('rds-standby'): n['label'] = 'RDS Standby'
# 새 AZ 의 선: ALB → EC2, EC2 → DB, EC2 → NAT, NAT → IGW, 복제
web_c, nat_c, rds_c = idmap['web-b'], idmap['nat-b'], idmap['rds-standby']
E = lambda i, s, t, **k: {'id': i, 'source': s, 'target': t, 'label': k.get('label', ''), 'line': k.get('line', 'solid'), 'shape': k.get('shape', 'elbow'), 'arrow': 'end'}
# RDS Primary 는 가운데 AZ(B)로, Standby 는 양옆(A·C). 선이 아이콘을 관통하지 않게
for n in g['nodes']:
    if n['id'] == 'rds-primary': n['parent'] = 'db-b'
    if n['id'] == 'rds-standby': n['parent'] = 'db-a'
# 앱 계층 → DB 는 EC2 마다 긋지 않고 Auto Scaling group 에서 한 줄 (세로로 곧게 내려간다)
g['edges'] = [e for e in g['edges'] if e['id'] not in ('e-web-a-db', 'e-web-b-db')]
for e in g['edges']:
    if e['id'] == 'e-db-sync': e['label'] = '동기 복제'
g['edges'] += [
    E('e-alb-web-c', 'alb', web_c),
    E('e-asg-db', 'asg', 'rds-primary', shape='straight'),
    E('e-db-sync-c', 'rds-primary', rds_c, line='dashed', shape='straight', label='동기 복제'),
    E('e-web-c-nat', web_c, nat_c, line='dashed'),
    E('e-nat-c-igw', nat_c, 'igw', line='dashed'),
]
g['title'] = '3티어 웹 (AZ 3개)'
g['meta'] = {**g['meta'], 'id': 'three-tier-web-3az', 'name': '3티어 웹 (AZ 3개)', 'description': 'ALB + Auto Scaling EC2 + RDS (AZ 3개에 걸쳐)'}
save('02b_three_tier_web_3az.json', g)
print('ok', idmap)
