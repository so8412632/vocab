// ---------------------------------------------------------------
// 只有這個檔案需要你自己修改！
// ---------------------------------------------------------------
// 1. 到 https://aistudio.google.com/apikey 用 Google 帳號登入
// 2. 點「Create API key」，不需要信用卡
// 3. 複製那串金鑰，貼到下面的引號中間
//
// 這把金鑰是「免費」的（Google AI Studio 的免費額度，不需要付款方式），
// 但因為這是純前端網站，金鑰會出現在瀏覽器看得到的原始碼裡。
// 最壞的狀況只是「別人拿去用、把你的免費額度用光」，
// 不會產生任何費用 —— 額度用完之後查詢會暫時失敗，重新申請一把新的
// 金鑰就能解決。
//
// 如果想降低被別人抓走亂用的風險，可以到 Google AI Studio /
// Google Cloud Console 幫這把 key 加上「HTTP referrer 限制」，
// 只允許從你自己的 GitHub Pages 網址（例如
// https://你的帳號.github.io/*）發出的請求才有效。
// ---------------------------------------------------------------

const GEMINI_API_KEY = "AQ.Ab8RN6LN1tVLbgbFrDmA1oBu0RrdftG8fZ3_vjJtThzrgy7oiw";

// 目前 Google AI Studio 免費方案可用的模型之一。
// 如果之後這個模型代號失效（Google 偶爾會調整免費模型清單），
// 到 https://aistudio.google.com 的模型列表確認目前可用的免費模型
// 名稱，改這裡即可，其他程式碼都不用動。
const GEMINI_MODEL = "gemini-2.5-flash";
