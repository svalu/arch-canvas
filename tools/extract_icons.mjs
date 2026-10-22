// Icon Shelf index.html 안의 <script id="data"> 블록에서 아이콘을 뽑아 data/icons.json 을 만든다.
// - 서비스/리소스/카테고리 아이콘은 같은 이름의 여러 규격(16/32/48/64) 중 48 규격 하나만 남긴다(캔버스 기본 48px).
// - 그룹 종류(groupKinds)는 Architecture-Group-Icons 의 각 SVG 배경 사각형 색을 뽑아서 만든다.
//   선 모양(실선/점선)과 채움 규칙만 AWS 아키텍처 아이콘 가이드에서 가져오고, 색은 하드코딩하지 않는다.
// 사용: node tools/extract_icons.mjs [Icon Shelf index.html 경로]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || 'E:/ai heerang/Icon_Shelf_Edge_v1.3.1/Icon_Shelf_Edge_v1.3.1/index.html';
const html = fs.readFileSync(src, 'utf8');
const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) throw new Error('data 블록을 찾지 못했어: ' + src);
const all = JSON.parse(m[1]);

const svgText = (d) => Buffer.from(d.src.split(',')[1], 'base64').toString('utf8');
// 그룹/카테고리 SVG는 맨 처음 <rect fill="#XXXXXX"> 가 공식 색이다.
const rectFill = (d) => {
  const r = svgText(d).match(/<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/);
  if (!r) throw new Error('배경색을 못 찾음: ' + d.file);
  return r[1].toUpperCase();
};
const byFile = new Map(all.map((d) => [d.file, d]));
const need = (file) => {
  const d = byFile.get(file);
  if (!d) throw new Error('아이콘 없음: ' + file);
  return d;
};

function kindOf(d) {
  if (d.path.includes('Architecture-Group-Icons')) return 'group';
  if (d.path.includes('Architecture-Service-Icons')) return 'service';
  if (d.path.includes('Resource-Icons')) return 'resource';
  if (d.path.includes('Category-Icons')) return 'category';
  return 'custom';
}
// Arch_Amazon-EC2_48.svg -> Arch_Amazon-EC2 , AWS-Cloud_32_Dark.svg -> AWS-Cloud_Dark
const keyOf = (file) => file.replace(/\.svg$/i, '').replace(/_(16|32|48|64)(?=_|$)/, '');

const PREFERRED = ['48', '64', '32', '16'];
const groups = new Map();
for (const d of all) {
  const key = keyOf(d.file);
  (groups.get(key) || groups.set(key, []).get(key)).push(d);
}

// 한국어로 찾을 때 자주 쓰는 말 몇 개. (검색어 -> 아이콘 이름에 들어 있는 말)
const KO = {
  'Elastic Load Balancing': '로드밸런서 로드 밸런서 부하분산 ALB NLB ELB',
  'Amazon EC2': '서버 인스턴스 가상머신 VM',
  'Amazon RDS': '데이터베이스 DB 관계형',
  'Amazon Aurora': '데이터베이스 DB 오로라',
  'Amazon DynamoDB': '데이터베이스 DB NoSQL 다이나모',
  'Amazon S3': '스토리지 버킷 저장소 오브젝트',
  'Simple Storage Service': '스토리지 버킷 저장소 S3',
  'AWS Lambda': '람다 서버리스 함수',
  'Amazon API Gateway': 'API 게이트웨이',
  'Amazon CloudFront': 'CDN 클라우드프론트 캐시',
  'Amazon Route 53': 'DNS 도메인 라우트53',
  'Amazon Elastic Container Service': 'ECS 컨테이너',
  'Amazon Elastic Kubernetes Service': 'EKS 쿠버네티스 k8s 컨테이너',
  'AWS Direct Connect': '전용선 다이렉트커넥트 DX',
  'AWS Site-to-Site VPN': 'VPN 사이트간',
  'Internet Gateway': '인터넷 게이트웨이 IGW',
  'NAT Gateway': 'NAT 게이트웨이',
  'Amazon CloudWatch': '모니터링 로그 클라우드워치',
  'AWS WAF': '방화벽 웹방화벽',
  'Amazon Cognito': '인증 로그인 코그니토',
  'Amazon ElastiCache': '캐시 레디스 Redis',
  'Amazon Simple Queue Service': 'SQS 큐 대기열',
  'Amazon Simple Notification Service': 'SNS 알림',
  'Users': '사용자 유저',
  'User': '사용자 유저',
  'Client': '클라이언트 단말',
  'Internet': '인터넷',
};
const koFor = (name) =>
  Object.entries(KO)
    .filter(([k]) => name.includes(k))
    .map(([, v]) => v)
    .join(' ');

const icons = [];
for (const [key, list] of groups) {
  list.sort((a, b) => PREFERRED.indexOf(a.size) - PREFERRED.indexOf(b.size));
  const d = list[0];
  const kind = kindOf(d);
  icons.push({
    key,
    name: d.name,
    category: d.category,
    kind,
    ko: koFor(d.name) || undefined,
    src: d.src,
  });
}
const order = { service: 0, resource: 1, group: 2, category: 3, custom: 4 };
icons.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));

// --- 그룹 종류 ---------------------------------------------------------------
// line: solid | dashed | none,  fill: none | tint(공식 색 10% 틴트) | dark(짝이 되는 라이트 변형의 색으로 채움)
// AWS 가이드: Region/AZ/Auto Scaling 은 점선, 서브넷은 테두리 없이 10% 틴트 채움(Public #F2F6E8 = #7AA116의 10%),
// Availability Zone 은 아이콘 없이 Region 색 점선, Security group 은 아이콘 없이 빨간(보안 카테고리 색) 실선.
const GROUP_RULES = [
  { id: 'aws-cloud', name: 'AWS Cloud', icon: 'AWS-Cloud_32.svg', line: 'solid', fill: 'none' },
  { id: 'aws-cloud-logo', name: 'AWS Cloud', icon: 'AWS-Cloud-logo_32.svg', line: 'solid', fill: 'none' },
  { id: 'region', name: 'Region', icon: 'Region_32.svg', line: 'dashed', fill: 'none' },
  { id: 'az', name: 'Availability Zone', icon: null, colorFrom: 'Region_32.svg', line: 'dashed', fill: 'none' },
  { id: 'vpc', name: 'VPC', icon: 'Virtual-private-cloud-VPC_32.svg', line: 'solid', fill: 'none' },
  { id: 'public-subnet', name: 'Public subnet', icon: 'Public-subnet_32.svg', line: 'none', fill: 'tint' },
  { id: 'private-subnet', name: 'Private subnet', icon: 'Private-subnet_32.svg', line: 'none', fill: 'tint' },
  { id: 'security-group', name: 'Security group', icon: null, colorFrom: 'Arch-Category_Security-Identity_48.svg', line: 'solid', fill: 'none' },
  { id: 'auto-scaling', name: 'Auto Scaling group', icon: 'Auto-Scaling-group_32.svg', line: 'dashed', fill: 'none' },
  { id: 'aws-account', name: 'AWS Account', icon: 'AWS-Account_32.svg', line: 'solid', fill: 'none' },
  { id: 'corporate-dc', name: 'Corporate data center', icon: 'Corporate-data-center_32.svg', line: 'solid', fill: 'none' },
  { id: 'ec2-contents', name: 'EC2 instance contents', icon: 'EC2-instance-contents_32.svg', line: 'solid', fill: 'none' },
  { id: 'server-contents', name: 'Server contents', icon: 'Server-contents_32.svg', line: 'solid', fill: 'none' },
  { id: 'spot-fleet', name: 'Spot Fleet', icon: 'Spot-Fleet_32.svg', line: 'solid', fill: 'none' },
  { id: 'greengrass', name: 'AWS IoT Greengrass Deployment', icon: 'AWS-IoT-Greengrass-Deployment_32.svg', line: 'solid', fill: 'none' },
  { id: 'generic', name: 'Generic group', icon: null, colorFrom: 'Server-contents_32.svg', line: 'dashed', fill: 'none' },
  { id: 'aws-cloud-dark', name: 'AWS Cloud (Dark)', icon: 'AWS-Cloud_32_Dark.svg', line: 'solid', fill: 'dark', darkFrom: 'AWS-Cloud_32.svg' },
  { id: 'aws-cloud-logo-dark', name: 'AWS Cloud (Dark)', icon: 'AWS-Cloud-logo_32_Dark.svg', line: 'solid', fill: 'dark', darkFrom: 'AWS-Cloud-logo_32.svg' },
];

const tint = (hex, t) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(255 - t * (255 - c)));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
};

const groupKinds = GROUP_RULES.map((r) => {
  const color = rectFill(need(r.icon || r.colorFrom));
  let fill = null;
  let text = color;
  if (r.fill === 'tint') fill = tint(color, 0.1);
  if (r.fill === 'dark') { fill = rectFill(need(r.darkFrom)); text = color; }
  return {
    id: r.id,
    name: r.name,
    icon: r.icon ? keyOf(r.icon) : null,
    color,               // 테두리/라벨 색 (SVG에서 추출)
    line: r.line,        // solid | dashed | none
    fill,                // null 이면 채움 없음
    text,                // 라벨 색
    colorSource: r.icon || r.colorFrom,
  };
});

const out = {
  source: path.basename(path.dirname(src)) + '/index.html',
  generatedAt: new Date().toISOString().slice(0, 10),
  iconCount: icons.length,
  icons,
  groupKinds,
};
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'icons.json'), JSON.stringify(out));
console.log(`icons: ${icons.length} (원본 ${all.length})`);
console.table(groupKinds.map(({ id, color, line, fill, text }) => ({ id, color, line, fill, text })));
const dup = icons.filter((x, i) => icons.findIndex((y) => y.key === x.key) !== i);
if (dup.length) console.warn('중복 key:', dup.map((d) => d.key));
