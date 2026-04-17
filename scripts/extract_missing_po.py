import re
import json

with open("frontend/src/locales/zh-CN/messages.po", "r", encoding="utf-8") as f:
    content = f.read()

# Match untranslated messages in the PO file
# A typical entry looks like:
# msgid "Some string"
# msgstr ""
untranslated = []
blocks = content.split('\n\n')
for block in blocks:
    if 'msgstr ""' in block and not block.strip().endswith('msgstr ""\n"'):
        # Extract msgid
        match = re.search(r'msgid "(.+?)"\nmsgstr ""', block, flags=re.DOTALL)
        if match:
            msgid = match.group(1).replace('"\n"', '')
            untranslated.append(msgid)

with open("missing_translations.json", "w", encoding="utf-8") as f:
    json.dump(untranslated, f, indent=2, ensure_ascii=False)
