# KenMap 使用手冊

這份文件的目標是讓你不用讀任何程式碼，就能把 KenMap 用起來。概念說明看 [README](../README.md)，這裡只講「怎麼操作」。

---

## 目錄

1. [安裝](#1-安裝)
2. [第一次在一個 repo 裡使用：`/kenmap:comprehend init`](#2-第一次在一個-repo-裡使用kenmapcomprehend-init)
3. [日常使用：`/kenmap:comprehend`](#3-日常使用kenmapcomprehend)
4. [指定模組：`/kenmap:comprehend <module-or-path>`](#4-指定模組kenmapcomprehend-module-or-path)
5. [看懂地圖頁面](#5-看懂地圖頁面)
6. [分數是怎麼算出來的](#6-分數是怎麼算出來的)
7. [同步到網站與 README 徽章](#7-同步到網站與-readme-徽章)
8. [清除 KenMap 的所有資料：`/kenmap:comprehend reset`](#8-清除-kenmap-的所有資料kenmapcomprehend-reset)
9. [不透過 skill，直接下指令](#9-不透過-skill直接下指令)
10. [疑難排解](#10-疑難排解)
11. [目前的已知限制](#11-目前的已知限制)

---

## 1. 安裝

KenMap 是一個 Claude Code plugin，不是獨立 app。需要 Node.js 20 以上和 git。

在終端機裡打這兩行：

```bash
claude plugin marketplace add nvlznn/kenmap
claude plugin install kenmap@noky
```

第一行把 KenMap 的 marketplace（名字叫 `noky`）加進你的 Claude Code，第二行從裡面安裝 `kenmap` 這個 plugin。不需要 clone 任何東西。

已經在 Claude Code 對話裡（terminal 或 VSCode 擴充套件）的話，改打 `/plugin marketplace add nvlznn/kenmap` 和 `/plugin install kenmap@noky`。注意 `/plugin` 開頭的指令只能在 Claude Code 裡打，直接貼進 zsh 會出現 `no such file or directory: /plugin`。

裝好之後打 `/kenmap:comprehend help`，會用一張表列出所有指令。指令前面的 `kenmap:` 是 plugin 的名字，Claude Code 規定 plugin 裡的指令都要帶這個前綴。

### 之後怎麼取得更新

第三方 marketplace 預設不會自動更新，擇一：

- **手動**：終端機裡打 `claude plugin update kenmap@noky`，或在 Claude Code 裡打 `/plugin marketplace update noky`
- **自動**：打 `/plugin` → Marketplaces → noky → Enable auto-update

更新完開一個新對話就會用新版。

### 從舊的安裝方式（symlink）換過來

如果你之前是用 `ln -s ... ~/.claude/skills/comprehend` 裝的，先刪掉那個捷徑，不然會同時有 `/comprehend` 和 `/kenmap:comprehend` 兩份：

```bash
rm ~/.claude/skills/comprehend
```

`rm` 刪的只是捷徑，不會動到你 clone 下來的 repo，也不會動到任何 repo 裡的作答紀錄。

---

## 2. 第一次在一個 repo 裡使用：`/kenmap:comprehend init`

**每個 repo 只需要做這一步一次。** 目的是讓 KenMap 認識這個 repo 的模組邊界。

### 怎麼開始

打開 Claude Code，站到你要測量的 repo 裡（讓那個 repo 成為目前對話的工作目錄），打：

```
/kenmap:comprehend init
```

### 會發生的事，一步一步

1. **KenMap 掃描整個 repo。** 它讀 `git ls-files` 追蹤到的所有檔案，統計每個目錄的檔案數、行數、有沒有自動產生的痕跡、還有程式碼之間互相 import 的情況。這一步**不需要你先設定任何東西**——KenMap 不預設你的原始碼放在哪個資料夾、用什麼語言、有沒有套件描述檔。
2. **KenMap 把掃描結果講給你聽。** 例如「這是個 Dart 專案，套件叫 xxx，藏在 `src/app/` 底下；`lib/widgets` 有 62 個檔案共 11000 多行，是最大的一塊」。
3. **KenMap 用一張表提出模組切法**：每個模組包含哪些路徑、確切的行數和檔案數（由程式算出，不是估計）、以及一句為什麼這樣切；另一張表列出不納入的目錄和原因；最後一行告訴你總共納入、不納入各多少行。 不會硬套固定數量的模組，會依照這個 repo 實際的樣子來切——有套件邊界就照套件邊界切，目錄夠有意義就照目錄切，如果檔案全部攤在同一層，會用「哪些檔案互相 import 最頻繁」來找出自然的分界。看起來像自動產生的目錄（例如打包工具生出來的檔案），會被排除在模組之外，但一定會明講排除了什麼、為什麼——不會偷偷排除,因為排除的程式碼會讓分數失真。
4. **這是對話，不是選單。** 你可以直接說「這個模組太大了，拆開」或「這兩個目錄其實應該合併」，KenMap 會照你的意思調整。**模組邊界是你以後要一直用下去的東西**，值得花時間談清楚。
5. **確認之後才寫檔。** KenMap 會把最終版本寫進 `.kenmap.json`（放在 repo 根目錄）。寫之前會先驗證——**如果哪個模組的規則一個檔案都配不到，它會拒絕寫入**，因為那樣會讓那個模組從算分裡消失，分數反而會不合理地變高。
6. **KenMap 會問你兩件事，都要你同意才會做：**
   - 要不要把 `.kenmap.json` commit 進 main 分支
   - 要不要把 `.kenmap-data/` 加進 `.gitignore`（這是之後測驗資料暫存的地方，不該被追蹤進 main 分支）

   **建議兩個都答應**，否則之後每次使用都會被提醒工作目錄不乾淨。

### 完成後你會有什麼

repo 根目錄多一個 `.kenmap.json`，長得像這樣（實際內容依你的 repo 而定）：

```json
{
  "version": 1,
  "user": "你的 GitHub 帳號",
  "modules": {
    "ui": ["lib/ui/**"],
    "data": ["lib/data/**"]
  }
}
```

**這份檔案之後不會自己變動**，除非你重新跑一次 `/kenmap:comprehend init`。

### 之後想重新調整模組邊界

再跑一次 `/kenmap:comprehend init`。KenMap 不會直接覆蓋——它會先列出現有的模組跟各自的狀況，問你要保持不變、調整幾個、還是整個重來。

**要注意的地方**：如果你把某個模組的 id 改掉（例如把 `ui` 改成 `screens`），這個模組之前累積的所有測驗紀錄會跟著失聯——系統會把它當成一個全新的、從沒考過的模組。KenMap 會在你改之前先警告你這件事。

---

## 3. 日常使用：`/kenmap:comprehend`

這是你會最常打的指令，每次只做一件事：考你一題，然後看分數怎麼變。

```
/kenmap:comprehend
```

### 會發生的事，一步一步

KenMap 刻意做得很短：只用中文回覆、不寒暄、不解釋自己在做什麼，出題前和答題後各只跑一個指令，讓你少等。

1. **KenMap 挑模組、讀程式碼，一次完成。** 沒給參數的話，先挑**答到一半、還沒答滿 3 題**的模組，讓它早點有分數；沒有的話挑**從來沒被考過**的模組（多個就挑最大的）；全部都有分數了才去算分數、挑最低的。它最多讀 1000 行，優先讀「被其他模組 import 最多次」的檔案，因為那些通常是模組對外的介面；自動產生的檔案不讀。它也會看到這個模組之前問過哪些題目，避免重複。
2. **只問你一題。** 題目的目標是確認你看得懂程式碼、知道每個取捨、說得出每個技術選擇的理由，所以有五種題型，依這個模組問過的題型**輪流出**，每種都會輪到；任何模組的第一題一定是「取捨與技術債」。題目開頭會標出題型，讓你知道要回答到什麼程度。

   | 題型 | 高度 | 問什麼 | 要答到什麼程度 |
   |---|---|---|---|
   | 取捨與技術債 | 系統／模組 | 點名一個架構決定（例如「資料在啟動時整批載入」），問這樣做的好處，以及在什麼情況下會出問題 | 好處和問題都要講，只講好處最高 50% |
   | 讀懂程式碼 | 程式碼 | 點名一個重要的函式（不附程式碼），問它一個名字看不出來的關鍵行為，例如某種情況下回傳什麼、除了主要工作還改了什麼 | 只把函式名稱換句話說最高 25% |
   | 為什麼選 A 不選 B | 系統／模組 | 點名實際採用的做法，要你講出放棄的方案 | 至少講出一個被放棄的替代方案；沒講最高 25%，講了但說不出它為什麼沒被選上最高 50% |
   | 情境改變 | 系統 | 寫明什麼變了、變多少（例如追蹤人數變 10 倍），問設計哪裡先撐不住 | 要指出哪裡最先壞、怎麼壞，只說「會變慢」最高 50% |
   | 為什麼這樣設計 | 模組 | 點名一條責任邊界或資料流，問反過來做會發生什麼 | 機制和後果都說對才是滿分 |

   「讀懂程式碼」題的題目只寫函式名稱，不塞長長的路徑；檔案路徑和行號附在題目最下方，例如 `src/app/lib/screens/todo_screen.dart:258–264`。在 VSCode 裡點一下就會跳到那幾行（前提是 VSCode 開的資料夾就是這個 repo）。

   每一題都是**簡答題**：只問一件事，滿分答案一到三行就寫得完。評分只看題目明確問到的東西，題目沒問的細節不會扣分。除了「讀懂程式碼」，題目都停在設計討論的高度，不需要你記得某個函式或檔案叫什麼。不會問「這裡有沒有技術債」這種不知道從哪答起的題目，也不會問函式名字、參數、有幾個檔案這種照抄畫面就答得出來的東西。

   如果**這個模組**有還沒 commit 的變更，題目下面會多一行提醒：分數是綁在目前的 commit 上。它只提醒、不會停下來問你要不要繼續。其他地方的未 commit 變更不影響這一題，所以不會提醒。
3. **你憑印象回答**，不要去翻程式碼——分數量的是「你腦子裡還記得什麼」，不是「你能不能查到答案」。
4. **KenMap 評分、記錄、推到 GitHub，一次完成。** 評分只有五種：0、0.25、0.5、0.75、1。這一題的完整內容——題目、你的回答、分數、理由、當下的 commit、時間——會被存下來，**不是只存一個數字**，分數才經得起事後檢查。紀錄會自動推到這個 repo 的 `kenmap-data` 分支，[kenmap.noky.dev](https://kenmap.noky.dev) 上的地圖跟著更新，但**不會自動跳出瀏覽器**。
5. **回覆很短**：這題的分數和一兩句解釋，接著一張小表比較這個模組和整個 repo「作答之前」與「現在」的分數，最後一行是「接下來」提示，列出這時最可能用到的指令：模組還沒答滿 3 題時提示繼續考，有分數之後提示再考一題，兩種情況都會附上 `/kenmap:comprehend help` 讓你查所有指令。每個流程（init、web、reset）做完時也都會有這一行。表格下面一定會附上網站上的地圖連結，想看再點。推送失敗（例如沒網路）的話會多一行說明，作答不會遺失，下一題會一起推上去（見[第 7 節](#7-同步到網站與-readme-徽章)）。

---

## 4. 指定模組：`/kenmap:comprehend <module-or-path>`

不想被系統自動挑，可以自己指定要考哪個模組：

```
/kenmap:comprehend ui
```

或者更方便的，**直接給檔案或資料夾路徑**，不用記模組叫什麼名字——例如你正在看某個檔案，直接把路徑貼給它：

```
/kenmap:comprehend lib/ui/home_screen.dart
/kenmap:comprehend lib/ui/
```

KenMap 會自動判斷這個路徑屬於哪個模組。如果這個路徑**同時橫跨好幾個模組**（例如你給了一個很上層的資料夾），KenMap 不會亂猜，會列出有哪幾個候選，讓你自己選一個。

---

## 5. 看懂地圖頁面

地圖在 [kenmap.noky.dev](https://kenmap.noky.dev) 上，`/kenmap:comprehend` 考完附上的連結點開就是這個 repo 的地圖。想直接打開，打 `/kenmap:comprehend web`：它會先重算分數（程式碼改過的話分數會變）、推到 GitHub，再打開網站並附上連結。

### 畫面組成

- **頁面最上方**：整個 repo 的總分（百分比），這是**依照各模組的行數加權平均**出來的——行數多的模組，對總分的影響力比較大。
- **中間的圖**：像一棵檔案樹。
  - **最上面的圓圈**是整個 repo，底下一列是各個模組，從上往下的 `CONTAINS` 線代表「這個 repo 包含這個模組」。
  - **圓圈顏色** = 分數，從紅（0%）一路漸變到綠（100%），中間的分數就是中間的顏色（橘、黃、黃綠）。**還沒有分數的模組也是紅色**，因為一個模組要答滿 3 題才有分數，之前都算 0 分。圓圈裡會顯示進度：沒考過是「—」、答了一題是「1/3」、兩題是「2/3」，跟考過但拿 0 分的「0%」區分開來。
  - **圓圈大小** = 這個模組有多少行程式碼，行數越多圈越大。
  - **模組列下方的弧線** = 模組之間互相 import，越常 import 線越明顯；兩個模組互相 import 會合併成一條兩頭都有箭頭的弧線。這些線平常是淡的，點一下模組才會亮起來並顯示次數。連線來自語言 adapter（目前只有 Dart）；KenMap 還不認得的語言一樣能算分，只是沒有弧線。
- **點一下任何圓圈**：跟它有關的線會亮起來、無關的模組會淡出，右側會展開這個模組的細節（點最上面的 repo 圓圈則會顯示整個 repo 的摘要，點空白處取消選取）——目前分數（還沒答滿 3 題的話，會寫還差幾題）、總行數、檔案數、以及**最近三次作答各自的紀錄**：每筆都寫著「你當初答對幾成」「現在實際算作幾成」，兩者的差距就是被 churn（程式碼變動）吃掉的部分。
- **頁面上方如果出現黃色警告框**：代表 KenMap 發現了某些狀況，例如某個模組的規則配不到任何檔案、或某筆紀錄的基準 commit 已經找不到了。這些警告不會讓分數算不出來，但值得看一眼。

### 誰看得到

- **你自己**：[kenmap.noky.dev](https://kenmap.noky.dev)。用 GitHub 登入後按「Connect a repository」，在 GitHub 上選要連的 repo（組織的 repo 就選那個組織），之後就能在網站上看到每個 repo 的分數和地圖，**私有 repo 也可以**。KenMap 只要求讀取程式碼的權限，不會寫入任何東西。至少答過一題、紀錄推上 GitHub 之後才看得到分數。
- **分享連結**：`https://kenmap.noky.dev/?repo=owner/repo-name`。公開 repo 不用登入就能看，README 徽章點進去就是這個頁面；私有 repo 要登入、而且連接過才看得到。

---

## 6. 分數是怎麼算出來的

```
模組分數 = 最近 3 次作答的平均，每筆各自 × (1 − churn)
churn    = min(1, max(added, deleted) / max(舊行數, 現在行數))
```

用白話說：

- **每次作答的分數不是直接採用，而是先打折。** 打的折扣叫 churn，代表「你答完這題之後，這個模組的程式碼被改了多少」。改得越多，churn 越高，這筆作答對現在分數的貢獻就越小。
- **churn 只看程式碼變動，完全不看時間。** 你考完之後放著不動一年，分數不會掉一分；但如果隔天就被人（或 AI）大改，分數立刻反映出來。這是刻意的設計——這個工具量的是「你是不是還懂現在這份程式碼」，不是「你多久以前考過」。
- **一個模組要答滿 3 題才有分數。** 一題太少，說不上「懂這個模組」。答滿之前，這個模組在總分裡算 0 分，但每一題都會照樣評分、照樣顯示這題拿幾分。
- **有分數之後，模組分數是最近 3 次作答的平均**（每筆先各自打完 churn 折扣再平均）。這樣單一一次答差不會讓分數整個崩掉，但持續變動的模組分數還是會慢慢往下掉。
- **如果某筆紀錄的基準 commit 不見了**（例如歷史被 squash 或 rebase 過），KenMap 會先嘗試用當初的作答時間去反查一個替代的基準點；真的完全找不到，才會把這筆的 churn 標成「無法驗證」，並且照樣顯示原始分數，**不會假裝它是 0 分或 100 分**。

---

## 7. 同步到網站與 README 徽章

每答完一題，KenMap 會自動：

1. 建立（或找到）一個叫 `kenmap-data` 的 git 分支。**這個分支跟你的程式碼沒有共同的歷史**（術語叫 orphan branch），所以測驗紀錄不會混進你平常的開發歷史裡，你的 commit log 看起來完全不受影響，main 也不會被動到。
2. 把測驗紀錄、算好的報告、徽章用的資料 commit 到這個分支，推到 GitHub。網站讀的就是這裡。
3. **絕對不會 force push**——推送失敗（例如沒網路、或遠端已經有別台電腦推上去的新資料）時，這題的紀錄照樣留在你電腦上的這個分支，回覆會說明原因，下一次答題或 `/kenmap:comprehend web` 會再推一次，不會覆蓋掉別人的資料。

**要知道的事**：推上去的內容包含題目和你的作答原文。看得到這個 repo 的人，就看得到這些紀錄。

### 把徽章放進 README

答過至少一題之後，在你的 README 貼這行（記得換成你自己的帳號和 repo 名稱），點徽章就會打開這個 repo 的地圖：

```markdown
[![comprehension](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/<你的帳號>/<repo>/kenmap-data/badge.json)](https://kenmap.noky.dev/?repo=<你的帳號>/<repo>)
```

更省事的做法：在網站的 repo 列表按「Copy README snippet」，會直接複製好這一行。徽章只適用公開 repo，shields.io 讀不到私有 repo。

徽章顯示的百分比就是總分，顏色規則：

| 分數 | 顏色 |
|---|---|
| 還沒有任何模組答滿 3 題 | 灰色，寫「no data」 |
| < 40% | 紅 |
| 40%–69% | 黃 |
| ≥ 70% | 綠 |

**注意徽章會有快取延遲**：shields.io 跟 GitHub 的 raw 檔案服務都會快取，答完題之後徽章可能要幾分鐘才會更新，地圖網頁本身通常比較即時。

---

## 8. 清除 KenMap 的所有資料：`/kenmap:comprehend reset`

想在某個 repo 完全重新來過（例如模組邊界談得不理想，想整個重談），打：

```
/kenmap:comprehend reset
```

### 會發生的事

1. **KenMap 先用一張表列出找到的東西，什麼都不會刪。** 它會檢查這個 repo 裡有沒有
   `.kenmap.json`、本機的 `.kenmap-data/` 工作目錄、本機的 `kenmap-data`
   分支、以及 `origin` 上有沒有推過的 `kenmap-data` 分支。
2. **KenMap 會把找到的東西分成兩種風險等級講給你聽：**
   - **本機的**（設定檔、工作目錄、本機分支）——之後跑 `/kenmap:comprehend init`
     加上重新考幾題就能完全復原，刪掉沒什麼好擔心的。
   - **已經推上 `origin` 的分支**——這代表你的測驗紀錄已經在真實的 GitHub
     repo 上，**其他有權限看這個 repo 的人也看得到**。這不是靠本機操作
     就能復原的東西。
3. **這兩件事會分開問你**，你可以只清本機、只清遠端、或兩個都清——**KenMap
   不會因為你答應清本機，就順便把遠端也刪掉**，這兩個永遠是兩個獨立的
   決定。
4. 清完之後，這個 repo 對 KenMap 來說就像從沒被測量過。想重新開始，跑
   `/kenmap:comprehend init` 就好。

### 各自實際刪了什麼

| 你答應清除的範圍 | 實際動作 |
|---|---|
| 本機 | 刪除 `.kenmap.json`；移除 `.kenmap-data/` 這個 git worktree；刪除本機的 `kenmap-data` 分支（如果已經有 commit 過的話；推到 GitHub 上的那份不受影響） |
| 遠端 | 對 `origin` 執行 `git push origin --delete kenmap-data` |

---

## 9. 不透過 skill，直接下指令

平常用 `/kenmap:comprehend` 就夠了，以下是給想手動操作、或想確認某個環節有沒有正確執行的人看的。所有指令都要先 `cd` 到你要測量的那個 repo 底下再執行。

表裡的 `$KENMAP` 代表 KenMap 程式所在的資料夾：plugin 裝在 `~/.claude/plugins/cache/noky/kenmap/<版本>/`，或是你自己 clone 下來的 repo。

| 指令 | 做什麼 |
|---|---|
| `node $KENMAP/comprehend/scripts/structure.mjs --compact` | 用一行一個目錄的精簡格式印出這個 repo 的結構；`/kenmap:comprehend init` 背後跑的就是這個。不加 `--compact` 會印出完整 JSON |
| `node $KENMAP/comprehend/scripts/prepare.mjs [模組或路徑]` | 出題前的準備：決定要考哪個模組，並印出那個模組的程式碼和之前問過的題目 |
| `node $KENMAP/comprehend/scripts/scan.mjs` | 把上面的探測結果對照 `.kenmap.json`，算出每個模組實際歸類到哪些檔案、模組之間的連線 |
| `node $KENMAP/comprehend/scripts/scan.mjs --resolve "<路徑或模組id>"` | 查一個檔案/資料夾路徑屬於哪個模組 |
| `node $KENMAP/comprehend/scripts/write-config.mjs --json '<設定 JSON>'` | 手動寫入 `.kenmap.json`（會先驗證，配不到檔案的模組會被拒絕）；加 `--dry-run` 只驗證並回報每個模組的行數，不寫檔 |
| `node $KENMAP/comprehend/scripts/record.mjs --module <id> --score <0/0.25/0.5/0.75/1> --question "<題目>" --answer "<回答>" --rationale "<理由>"` | 手動寫入一筆測驗紀錄；加 `--sync` 會順便重算分數並推到 GitHub |
| `node $KENMAP/comprehend/scripts/report.mjs` | 重新計算所有模組的分數，同時更新 `report.json` 和 `badge.json` |
| `node $KENMAP/comprehend/scripts/site.mjs` | 重算分數、推到 GitHub，再打開網站上的地圖；`/kenmap:comprehend web` 背後跑的就是這個。加 `--no-open` 不開瀏覽器 |
| `node $KENMAP/comprehend/scripts/publish.mjs` | 重算分數並推送到 `kenmap-data` 分支；加 `--no-push` 只在本機 commit、不真的推送 |
| `node $KENMAP/comprehend/scripts/reset.mjs` | 只回報現況，不刪任何東西 |
| `node $KENMAP/comprehend/scripts/reset.mjs --local` | 清掉 `.kenmap.json`、本機工作目錄、本機分支 |
| `node $KENMAP/comprehend/scripts/reset.mjs --remote` | 刪掉 `origin` 上的 `kenmap-data` 分支 |

---

## 10. 疑難排解

**打完 `/kenmap:comprehend init`，模組建議看起來很奇怪。** 直接用對話跟它說哪裡不對——它是根據探測結果做判斷，不是固定規則，可以隨時調整。

**打 `/kenmap:comprehend` 說找不到指令。** 確認 plugin 有裝好而且是啟用的：打 `/plugin`，在 Installed 分頁找 `kenmap`。剛裝好的話，開一個新對話再試。

**同時出現 `/comprehend` 和 `/kenmap:comprehend`。** 你之前用 symlink 裝過舊版，照[第 1 節](#從舊的安裝方式symlink換過來)刪掉舊的捷徑。

**答完題，網站上的分數沒變。** 先看回覆裡有沒有「沒同步到網站」那一行，有的話照它寫的原因處理（常見的是沒網路，或推送權限不足）。沒有的話，在網站上重新整理一次頁面。

**題目下面多了一行「有未 commit 的變更」。** 代表你正在考的這個模組裡有還沒 commit 的改動。分數是綁在目前的 commit 上，所以這題量的是 commit 過的版本；想讓分數涵蓋新的改動，先 commit 再考。

**某個模組一直是 0 分。** 兩種可能：還沒答滿 3 題（圓圈顯示「—」或「1/3」「2/3」），或答滿了但答得不好（顯示「0%」）。沒指定模組直接打 `/kenmap:comprehend` 的話，KenMap 會優先接著考答到一半的模組。

**改寫了程式碼，分數卻沒有下降。** 檢查改動有沒有真的 commit——churn 是拿「考試當下的 commit」跟「現在的 HEAD」比對，沒 commit 的改動看不到。另外，網站只看得到推上去的分數：只改程式、沒答題的話，打一次 `/kenmap:comprehend web` 讓它重算並推上去。

**某筆紀錄的 churn 顯示「無法驗證」。** 代表當初考試那個 commit，在 git 歷史裡已經找不到了（通常是因為 squash merge 或 rebase）。這不是錯誤——分數還是會用你的原始作答分數，只是這部分的扣分沒辦法精確計算。

**網站上看不到某個 repo 的分數。** 確認這個 repo 至少答過一題，而且推送成功（第 7 節）。私有 repo 要先登入、並且在「Connect a repository」裡選到它；沒登入時網站只讀得到公開 repo。

---

## 11. 目前的已知限制

- **只支援 Dart 的 import 連線。** 其他語言一樣能正常算分、正常使用，只是地圖上不會畫連線。
- **改模組 id 會讓舊紀錄失聯。** 想重新命名模組，紀錄不會自動搬過去。
- **`打開瀏覽器` 這個動作在 Windows 上還沒接。** macOS 和 Linux 沒問題。
