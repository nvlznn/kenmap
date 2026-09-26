# KenMap

量測你還懂多少自己 repo 裡的程式碼。

覆蓋率工具告訴你測試碰過哪些行；KenMap 告訴你哪些模組你還解釋得出來。它一次考你一個模組，把分數記下來，並隨著底下的程式碼變動而讓分數下降——所以某個你沒跟上的 AI 改寫，會讓那個模組自己變紅。

結果是一張 repo 的熱力圖，加上一個 README 徽章。

## 分數怎麼算

```
模組分數 = 最近 3 次作答的平均，每筆各自 × (1 − churn)
churn    = min(1, max(added, deleted) / max(舊行數, 現在行數))
```

作答評分為 0 / 0.25 / 0.5 / 0.75 / 1。churn 是從你考試當時的 commit 算到 HEAD。分數不會因為時間經過而衰減——只有程式碼真的變動才會動它。

## 設計

KenMap 不對你的 repo 做任何預設。原始碼位置、套件描述檔、語言、模組邊界，全部在執行期從 `git ls-files` 探測出來。任何語言都能用；import 連線只在語言 adapter 認得該程式碼時才畫出來，認不出來就沒有連線。

LLM 只負責出題與批改。掃描、計分、以及所有寫檔動作都是確定性的 script。

- `.kenmap.json` 放在 main 分支，保存你確認過的模組邊界。
- orphan 分支 `kenmap-data` 保存測驗紀錄、報告與徽章。
- 沒有後端，沒有資料庫。

## 安裝

KenMap 是一個 Claude Code skill。用連結而不是複製，網頁模板才找得到；資料夾
名稱要叫 `comprehend`，跟 `SKILL.md` 裡登記的名字一致，`/comprehend` 才認得到：

```bash
ln -s "$PWD/comprehend" ~/.claude/skills/comprehend
```

接著在任何 repo 裡：

```
/comprehend init                    # 探測結構，談定模組邊界
/comprehend                         # 針對分數最低的模組回答一題
/comprehend <module id>             # 指定模組，用 init 談定的 id
/comprehend <file or folder path>   # 指定模組，直接給路徑也行，不用背 id
```

## 現況

已經跑通全流程：探測、計分、skill、本地地圖、發布與徽章。還沒驗證過的：真實的 GitHub remote，以及長期連續出題下的題目品質。

```bash
npm test
```
