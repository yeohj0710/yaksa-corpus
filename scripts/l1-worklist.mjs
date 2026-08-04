/**
 * L1 수동 전사 작업 목록. 외부 API를 호출하지 않습니다.
 *
 * stdout은 한 줄에 하나씩 JSON 객체를 출력합니다:
 * {"content_sha":"…","page":1,"subject_key":"…"}
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { select } from "../lib/manifest.mjs";

const rows = select({ routes: ["vision"] });

const work = [];
for (const row of rows) {
  for (let page = 1; page <= (row.pages || 0); page++) {
    const output = path.join(DIR.l1, row.content_sha, `p-${String(page).padStart(4, "0")}.md`);
    if (!existsSync(output)) {
      work.push({ content_sha: row.content_sha, page, subject_key: row.subject_key });
    }
  }
}

work.sort((a, b) =>
  a.subject_key.localeCompare(b.subject_key) ||
  a.content_sha.localeCompare(b.content_sha) ||
  a.page - b.page,
);

for (const item of work) console.log(JSON.stringify(item));
