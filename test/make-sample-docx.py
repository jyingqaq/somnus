import zipfile, os

def para(text, bold=False):
    b = '<w:b/>' if bold else ''
    return (
        '<w:p><w:r><w:rPr>%s</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % (b, text)
    )

paras = [
    para('第一章 雨夜'),
    para('林晚推开门的时候，雨水正顺着屋檐往下淌。'),
    para('她回头看了一眼巷口空荡荡的灯。'),
    para(''),
    para('“你终于来了。”屋里有人开口。'),
    para('桌上摊着一张发黄的地图，右下角画了个圈。'),
    para('特殊字符测试：&amp; &lt;标签&gt; &quot;引号&quot; &#65;&#x42;'),
    para('Tab\t制表符与换行测试'),
    para('结尾。'),
]

document = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:body>' + ''.join(paras) + '</w:body></w:document>'
)

content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)

rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '</Relationships>'
)

out = os.path.join(os.path.dirname(__file__), '测试角色设定.docx')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', rels)
    z.writestr('word/document.xml', document)
print('wrote', out, os.path.getsize(out), 'bytes')
