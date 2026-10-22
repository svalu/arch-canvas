# UI 문구를 반말(구어체)에서 문어체(합니다체)로 바꾼다. 둘러보기(Tour.jsx)는 제외.
# 규칙 기반 치환 뒤에 남는 반말 어미는 grep 으로 찾아 손으로 고친다.
import re, io, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ['src/App.jsx', 'src/ai/ui.jsx', 'src/guide/GuidePanel.jsx', 'src/canvas/nodes.jsx', 'src/ai/providers.js', 'src/ai/connection.js',
         'data/rules.json', 'data/guide.json']

END = r'(?=[.!?,)\]"\'`\n]|\\n| \(|$)'   # 문장 끝(마침표·따옴표·줄바꿈·여는 괄호 앞)
RULES = [
    # 특수/긴 것 먼저
    (r'해 줘' + END, '해 주세요'), (r'해줘' + END, '해 주세요'), (r'봐줘' + END, '봐 주세요'), (r'해봐' + END, '해 보세요'),
    (r'넣어줘' + END, '넣어 주세요'), (r'옮겨줘' + END, '옮겨 주세요'), (r'붙여줘' + END, '붙여 주세요'), (r'그려줘' + END, '그려 주세요'),
    (r'알려줘' + END, '알려 주세요'), (r'적어줘' + END, '적어 주세요'), (r'골라줘' + END, '골라 주세요'), (r'확인해줘' + END, '확인해 주세요'),
    (r'열어줘' + END, '열어 주세요'), (r'써줘' + END, '써 주세요'), (r'비교해줘' + END, '비교해 주세요'), (r'표기해줘' + END, '표기해 주세요'),
    (r'줘' + END, '주세요'), (r'봐' + END, '보세요'),
    (r'지적할 게 없대', '지적 사항이 없습니다'), (r'없대' + END, '없습니다'), (r'바꿀 명령이 없대', '바꿀 명령이 없습니다'),
    (r'안 돼' + END, '안 됩니다'), (r'못 해' + END, '못 합니다'), (r'돼' + END, '됩니다'), (r'해' + END, '합니다'),
    (r'없어' + END, '없습니다'), (r'있어' + END, '있습니다'), (r'같아' + END, '같습니다'), (r'좋아' + END, '좋습니다'),
    (r'거야' + END, '것입니다'), (r'이야' + END, '입니다'), (r'야' + END, '입니다'),
    (r'됐어' + END, '됐습니다'), (r'했어' + END, '했습니다'), (r'왔어' + END, '왔습니다'), (r'었어' + END, '었습니다'), (r'았어' + END, '았습니다'),
    (r'들어가' + END, '들어갑니다'), (r'떠' + END, '뜹니다'), (r'와' + END, '옵니다'), (r'남아' + END, '남습니다'), (r'커져' + END, '커집니다'),
    (r'줄어' + END, '줄어듭니다'), (r'바뀌어' + END, '바뀝니다'), (r'걸려' + END, '걸립니다'), (r'움직여' + END, '움직입니다'), (r'나와' + END, '나옵니다'),
    (r'달라져' + END, '달라집니다'), (r'버텨' + END, '버팁니다'), (r'아껴' + END, '아낍니다'), (r'넘어가' + END, '넘어갑니다'), (r'걸러' + END, '거릅니다'),
    (r'뿌려' + END, '뿌립니다'), (r'끊겨' + END, '끊깁니다'), (r'보여' + END, '보입니다'), (r'쌓여' + END, '쌓입니다'), (r'생겨' + END, '생깁니다'),
    (r'드러나' + END, '드러납니다'), (r'흡수돼' + END, '흡수됩니다'), (r'가벼워져' + END, '가벼워집니다'), (r'빨라지고' , '빨라지고'), (r'읽혀' + END, '읽힙니다'),
    (r'나가' + END, '나갑니다'), (r'몰라' + END, '모릅니다'), (r'싫어' + END, '싫습니다'), (r'써' + END, '씁니다'), (r'가' + END, '갑니다'),
    (r'게 돼' + END, '게 됩니다'), (r'늘고 줄어' + END, '늘고 줄어듭니다'), (r'돌아가' + END, '돌아갑니다'), (r'이어져' + END, '이어집니다'),
    (r'못 읽었습니다', '읽지 못했습니다'), (r'쓸 수 있습니다', '사용할 수 있습니다'),
    # 호칭/구어
    (r'AI 한테', 'AI에게'), (r'AI한테', 'AI에게'), (r'모델한테', '모델에게'), (r'네 ', '사용자의 '), (r'내 ', '현재 '),
]

changed = 0
for rel in FILES:
    p = ROOT / rel
    s = p.read_text(encoding='utf-8')
    orig = s
    for pat, rep in RULES:
        s = re.sub(pat, rep, s)
    if s != orig:
        p.write_text(s, encoding='utf-8')
        changed += 1
        print('formalized', rel)
print('files changed:', changed)
