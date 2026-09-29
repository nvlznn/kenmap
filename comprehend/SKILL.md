---
name: comprehend
description: Quiz yourself on one module of this repo and record how well you still understand it. Use when the user runs /comprehend, asks to be quizzed on code they own, asks how much of their codebase they still understand, or wants to set up, update or wipe KenMap module boundaries and data.
---

# comprehend

一次考一個模組、一題，量使用者還懂多少自己的程式碼。分數會隨程式碼被改動而下降。

## 回覆規則（每一則都適用）

- **只用繁體中文回覆。** 識別字、路徑、指令保持原樣。
- **越短越好。** 不寒暄、不說明你正在做什麼、不重述使用者的話、不列步驟、不加總結。只輸出下面各流程規定的內容。
- **能少做就少做。** 每個流程只跑規定的指令，不額外讀檔、不額外檢查。使用者每多等一次工具呼叫，就多等一輪。
- script 都在這個檔案旁的 `scripts/`，在目標 repo 根目錄用 `node` 執行。**絕不手寫** `.kenmap.json` 或 `results.jsonl`。

## 用法

- `/comprehend` — 考分數最低的模組
- `/comprehend <模組 id 或檔案／資料夾路徑>` — 考指定模組
- `/comprehend init` — 設定或調整模組邊界
- `/comprehend reset` — 清除這個 repo 裡 KenMap 的資料

`.kenmap.json` 不存在時，不管使用者要什麼，先走 init。

## 出題（全程只有兩次指令呼叫）

1. 執行 `node scripts/prepare.mjs [參數]`。這一次就會給你：要考的模組、那個模組有沒有未 commit 的變更、之前問過的題目、以及要讀的程式碼。**不要再讀其他檔案、不要跑其他指令。**
   - 輸出「橫跨多個模組」→ 一句話請使用者選一個，停。
   - 輸出「錯誤」→ 一句話轉述，停。
2. 只根據輸出的程式碼出**一題**，不要和「之前問過」重複。回覆格式：
   ```
   **<模組 id>**：<題目，一句話>
   ```
   如果有未 commit 的變更，第二行加上：`（這個模組有未 commit 的變更，分數以目前 commit 為準）`。不要問要不要繼續。
3. 使用者回答後，執行一次：
   ```bash
   node scripts/record.mjs --module <id> --score <0|0.25|0.5|0.75|1> \
     --question "<題目>" --answer "<使用者的回答>" --rationale "<一句評分理由>" --render
   ```
   它會記錄、重算分數、產生地圖並嘗試打開，回傳 `moduleScore`、`total`、`map`、`opened`。
4. 回覆格式（最多三行）：
   ```
   **<分數>** · <一兩句：答對了什麼、漏了什麼>
   <模組 id> 現在 <moduleScore×100>%，總分 <total×100>%
   要發布到 GitHub 就說「發布」。
   ```
   `opened` 是 `false` 時，第二行後面加上「地圖：<map>」。
5. 使用者說「發布」→ `node scripts/publish.mjs`，回一句結果。

### 什麼題目值得問

只問答案存在使用者腦中、翻程式碼找不到的東西：**為什麼這樣設計、換個做法會壞在哪**。圍繞模組的職責、邊界、資料怎麼流、怎麼失敗、做了什麼取捨。

好題目：
- 如果重試邏輯從 queue consumer 搬到 HTTP client，會開始出什麼問題？
- 兩個畫面都讀這份快取，為什麼其中一個要繞過它？
- 請求進行到一半 auth token 過期，正在寫入的資料會怎樣？

絕對不問：某個類別有哪些方法、某個函式做什麼、回傳什麼、有幾個檔案、import 了什麼套件。**答案看得到的題目就是錯的題目。**

評分看心智模型對不對，不看用字：

| 分數 | 意思 |
|---|---|
| 1 | 機制和後果都說對 |
| 0.75 | 結論對，推理模糊或不完整 |
| 0.5 | 只懂取捨的一邊 |
| 0.25 | 知道是哪一塊，但理解錯了 |
| 0 | 沒有可用的理解 |

誠實評分。給寬鬆分數是在騙唯一會被它傷到的人。

## init

1. 執行 `node scripts/structure.mjs --compact`。
2. 一則回覆提出模組切法，**依這個 repo 的實際樣子**，不設模組數量目標：有套件邊界就照套件切；目錄有意義就切在那一層；檔案全平攤就用 import 集中度找分界；以產生碼為主的目錄不納入，但要講出來。格式：
   ```
   - `<id>`：`<glob>`、`<glob>` — <一句理由>
   不納入：`<路徑>`（<原因>）
   這樣切可以嗎？
   ```
3. 使用者要調整就照改，只回改過的版本。
4. 確認後執行 `node scripts/write-config.mjs --json '{"version":1,"user":"<GitHub 帳號>","modules":{"<id>":["<glob>"]}}'`（glob 相對 repo 根目錄；有模組配不到檔案它會拒絕）。
5. 問一句：「要把 `.kenmap.json` commit，並把 `.kenmap-data/` 加進 `.gitignore` 嗎？」這兩件都會動到 main 分支，要使用者答應才做。

**重跑 init**：不要直接覆蓋。列出現有模組，問要保留、調整還是重來，並提醒改掉模組 id 會讓那個模組的舊紀錄失聯。

## reset

1. 執行 `node scripts/reset.mjs`（只回報現況，不刪任何東西）。全部都不存在就回「這個 repo 沒有 KenMap 的資料。」停。
2. 一則回覆列出找到的東西，並**分開**問：
   - 「清除本機資料嗎？（設定檔、工作目錄、本機分支，之後可以重建）」
   - 只有 `remoteBranch` 為 true 時才問：「也刪除 GitHub 上的 `kenmap-data` 分支嗎？（其他人看得到，刪了難復原）」
3. 只執行使用者答應的：`--local`、`--remote`，或兩個都加。**絕不因為使用者答應清本機，就順便加 `--remote`。**
4. 依輸出的 `removed` 回一句實際刪了什麼。

## 分數怎麼算（使用者問才講）

模組分數 = 最近 3 次作答的平均，每筆各自乘上 (1 − churn)；churn 是考試當時的 commit 到現在，這個模組被改了多少。不會因為時間經過而下降。基準 commit 被 squash 掉時，churn 會顯示「無法驗證」，不要當成 0。
