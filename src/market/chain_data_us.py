"""
美股產業鏈地圖的資料定義 (chain_data_us.py)：格式與台股的 chain_data.py 相同，個股代號改用美股 ticker。

「類股」用 11 檔 SPDR 類股 ETF（SECTOR_ETF）當代表：漲跌取 Yahoo 即時報價（美股盤中約延遲 0～5 秒），
作用等同台股的證交所類股指數。類股名稱沿用 GICS 11 大類的中文。
這是自行整理的示意分類，不是官方資料；個股歸類可能過時或有爭議，僅供研究參考，不構成投資建議。
ADR（TSM、ASML、NVO…）依其所屬產業歸類，與掛牌地無關。

怎麼更新（改完一定要跑）：
1. 在下面的 CHAINS 新增或修改一條產業鏈，股票用 ("ticker", "簡稱")；id 不能和台股 chain_data.py 的重複。
2. python -m unittest tests.test_industry_map   → 離線檢查結構
3. 啟動後打開產業鏈頁切到「美股」，確認每一檔都有報價（沒有報價的會顯示「—」）。
改完把 VERSION 改成修改日期。前端不用改。
"""

VERSION = "2026-11-04"

COLUMNS = ["原料與能源", "工業與地產", "科技與消費", "金融與健康"]
LAYOUT = [
    ["原物料", "能源", "公用事業"],
    ["工業", "房地產"],
    ["科技", "通訊服務", "非必需消費", "必需消費"],
    ["金融", "醫療保健"],
]

# 類股 → 代表它的 SPDR ETF
SECTOR_ETF = {
    "原物料": "XLB", "能源": "XLE", "公用事業": "XLU", "工業": "XLI", "房地產": "XLRE", "科技": "XLK",
    "通訊服務": "XLC", "非必需消費": "XLY", "必需消費": "XLP", "金融": "XLF", "醫療保健": "XLV",
}

LINKS = [
    ("原物料", "工業"), ("能源", "工業"), ("能源", "公用事業"), ("公用事業", "科技"), ("科技", "通訊服務"),
    ("科技", "非必需消費"), ("工業", "非必需消費"), ("工業", "房地產"),
]

CHAINS = [
    {
        "id": "us_semi", "name": "半導體", "sector": "科技", "blurb": "從 IC 設計與設備，經晶圓製造、封測，到類比與車用晶片",
        "stages": ["設計與工具", "設備與材料", "製造", "封測與終端晶片"],
        "nodes": [
            {"id": "design", "name": "IC 設計", "stage": 0, "stocks": [("NVDA", "輝達"), ("AMD", "超微"), ("AVGO", "博通"), ("QCOM", "高通"), ("MRVL", "邁威爾"), ("ARM", "安謀")]},
            {"id": "eda", "name": "EDA 與 IP", "stage": 0, "stocks": [("SNPS", "新思"), ("CDNS", "益華")]},
            {"id": "equip", "name": "半導體設備", "stage": 1, "stocks": [("ASML", "艾司摩爾"), ("AMAT", "應用材料"), ("LRCX", "科林研發"), ("KLAC", "科磊"), ("TER", "泰瑞達")]},
            {"id": "mat", "name": "材料與零件", "stage": 1, "stocks": [("ENTG", "英特格"), ("MKSI", "MKS")]},
            {"id": "fab", "name": "晶圓製造", "stage": 2, "stocks": [("TSM", "台積電 ADR"), ("INTC", "英特爾"), ("GFS", "格羅方德")]},
            {"id": "memory", "name": "記憶體與儲存", "stage": 2, "stocks": [("MU", "美光"), ("WDC", "威騰"), ("STX", "希捷")]},
            {"id": "osat", "name": "封裝測試", "stage": 3, "stocks": [("AMKR", "艾克爾")]},
            {"id": "analog", "name": "類比與車用晶片", "stage": 3, "stocks": [("TXN", "德儀"), ("ADI", "亞德諾"), ("ON", "安森美"), ("NXPI", "恩智浦"), ("MCHP", "微芯")]},
        ],
        "edges": [("design", "fab"), ("eda", "fab"), ("equip", "fab"), ("mat", "fab"), ("equip", "memory"), ("fab", "osat"), ("memory", "osat"), ("fab", "analog")],
    },
    {
        "id": "us_ai", "name": "AI 與雲端", "sector": "科技", "blurb": "晶片、伺服器與網通、電力散熱，到雲端平台與軟體應用",
        "stages": ["晶片與記憶體", "伺服器與基礎設施", "雲端平台", "應用與軟體"],
        "nodes": [
            {"id": "chip", "name": "AI 晶片", "stage": 0, "stocks": [("NVDA", "輝達"), ("AMD", "超微"), ("AVGO", "博通"), ("MRVL", "邁威爾")]},
            {"id": "mem", "name": "記憶體", "stage": 0, "stocks": [("MU", "美光"), ("WDC", "威騰")]},
            {"id": "server", "name": "伺服器", "stage": 1, "stocks": [("SMCI", "美超微"), ("DELL", "戴爾"), ("HPE", "慧與")]},
            {"id": "net", "name": "網通設備", "stage": 1, "stocks": [("ANET", "Arista"), ("CSCO", "思科"), ("CIEN", "Ciena")]},
            {"id": "power", "name": "電力與散熱", "stage": 1, "stocks": [("VRT", "維諦"), ("ETN", "伊頓")]},
            {"id": "cloud", "name": "雲端與大型平台", "stage": 2, "stocks": [("MSFT", "微軟"), ("AMZN", "亞馬遜"), ("GOOGL", "Alphabet"), ("META", "Meta"), ("ORCL", "甲骨文")]},
            {"id": "dc", "name": "資料中心", "stage": 2, "stocks": [("EQIX", "Equinix"), ("DLR", "Digital Realty")]},
            {"id": "app", "name": "軟體與應用", "stage": 3, "stocks": [("PLTR", "Palantir"), ("NOW", "ServiceNow"), ("CRM", "Salesforce"), ("SNOW", "Snowflake"), ("ADBE", "Adobe")]},
        ],
        "edges": [("chip", "server"), ("mem", "server"), ("chip", "net"), ("server", "cloud"), ("net", "cloud"), ("power", "dc"), ("power", "cloud"), ("cloud", "app"), ("dc", "app")],
    },
    {
        "id": "us_ev", "name": "電動車與電池", "sector": "非必需消費", "blurb": "鋰與關鍵礦、車用零件，到整車與充電、通路",
        "stages": ["原料", "零組件", "整車", "充電與通路"],
        "nodes": [
            {"id": "mat", "name": "鋰與稀土", "stage": 0, "stocks": [("ALB", "雅保"), ("SQM", "SQM"), ("MP", "MP Materials")]},
            {"id": "parts", "name": "車用零組件", "stage": 1, "stocks": [("APTV", "安波福"), ("BWA", "博格華納"), ("LEA", "李爾")]},
            {"id": "oem", "name": "整車廠", "stage": 2, "stocks": [("TSLA", "特斯拉"), ("GM", "通用"), ("F", "福特"), ("RIVN", "Rivian"), ("LCID", "Lucid")]},
            {"id": "chg", "name": "充電網路", "stage": 3, "stocks": [("CHPT", "ChargePoint"), ("EVGO", "EVgo")]},
            {"id": "dealer", "name": "車商通路", "stage": 3, "stocks": [("CVNA", "Carvana"), ("KMX", "CarMax"), ("AN", "AutoNation")]},
        ],
        "edges": [("mat", "parts"), ("mat", "oem"), ("parts", "oem"), ("oem", "chg"), ("oem", "dealer")],
    },
    {
        "id": "us_bio", "name": "生技醫療", "sector": "醫療保健", "blurb": "研發工具、藥廠與生技、醫材，到通路與健康保險",
        "stages": ["研發工具", "藥廠與生技", "醫材", "通路與支付"],
        "nodes": [
            {"id": "tools", "name": "生命科學工具", "stage": 0, "stocks": [("TMO", "賽默飛"), ("DHR", "丹納赫"), ("A", "安捷倫"), ("ILMN", "Illumina")]},
            {"id": "pharma", "name": "大型藥廠", "stage": 1, "stocks": [("LLY", "禮來"), ("JNJ", "嬌生"), ("MRK", "默克"), ("PFE", "輝瑞"), ("ABBV", "艾伯維"), ("BMY", "必治妥"), ("NVO", "諾和諾德")]},
            {"id": "biotech", "name": "生技公司", "stage": 1, "stocks": [("AMGN", "安進"), ("GILD", "吉利德"), ("VRTX", "福泰"), ("REGN", "再生元"), ("MRNA", "莫德納")]},
            {"id": "device", "name": "醫療器材", "stage": 2, "stocks": [("ISRG", "直覺外科"), ("MDT", "美敦力"), ("SYK", "史賽克"), ("BSX", "波士頓科學"), ("ABT", "亞培")]},
            {"id": "dist", "name": "藥品通路", "stage": 3, "stocks": [("MCK", "麥克森"), ("COR", "Cencora"), ("CAH", "卡地納"), ("CVS", "CVS")]},
            {"id": "payer", "name": "健康保險", "stage": 3, "stocks": [("UNH", "聯合健康"), ("ELV", "Elevance"), ("CI", "信諾"), ("HUM", "哈門那")]},
        ],
        "edges": [("tools", "pharma"), ("tools", "biotech"), ("tools", "device"), ("pharma", "dist"), ("biotech", "dist"), ("device", "payer"), ("pharma", "payer")],
    },
    {
        "id": "us_fin", "name": "金融", "sector": "金融", "blurb": "銀行、券商資管、支付，到保險與交易所",
        "stages": ["銀行", "資本市場與支付", "保險與交易所"],
        "nodes": [
            {"id": "bank", "name": "大型銀行", "stage": 0, "stocks": [("JPM", "摩根大通"), ("BAC", "美國銀行"), ("C", "花旗"), ("WFC", "富國")]},
            {"id": "cap", "name": "投行與資管", "stage": 1, "stocks": [("GS", "高盛"), ("MS", "摩根士丹利"), ("SCHW", "嘉信"), ("BLK", "貝萊德")]},
            {"id": "pay", "name": "支付網路", "stage": 1, "stocks": [("V", "Visa"), ("MA", "萬事達"), ("AXP", "美國運通"), ("PYPL", "PayPal")]},
            {"id": "ins", "name": "保險", "stage": 2, "stocks": [("BRK-B", "波克夏"), ("PGR", "前進保險"), ("CB", "安達"), ("MET", "大都會"), ("AIG", "AIG")]},
            {"id": "exch", "name": "交易所與資料", "stage": 2, "stocks": [("CME", "芝商所"), ("ICE", "洲際交易所")]},
        ],
        "edges": [("bank", "cap"), ("bank", "pay"), ("cap", "ins"), ("cap", "exch"), ("pay", "ins")],
    },
    {
        "id": "us_energy", "name": "能源", "sector": "能源", "blurb": "油服、探勘生產，到中游運輸與煉油",
        "stages": ["油服與探勘", "生產", "中游運輸", "煉油"],
        "nodes": [
            {"id": "svc", "name": "油田服務", "stage": 0, "stocks": [("SLB", "斯倫貝謝"), ("HAL", "哈里伯頓"), ("BKR", "貝克休斯")]},
            {"id": "prod", "name": "探勘與生產", "stage": 1, "stocks": [("XOM", "埃克森美孚"), ("CVX", "雪佛龍"), ("COP", "康菲"), ("EOG", "EOG"), ("OXY", "西方石油")]},
            {"id": "mid", "name": "中游管線", "stage": 2, "stocks": [("KMI", "Kinder Morgan"), ("WMB", "Williams"), ("OKE", "ONEOK")]},
            {"id": "refine", "name": "煉油", "stage": 3, "stocks": [("MPC", "馬拉松石油"), ("VLO", "瓦萊羅"), ("PSX", "菲利普斯 66")]},
        ],
        "edges": [("svc", "prod"), ("prod", "mid"), ("mid", "refine")],
    },
    {
        "id": "us_aero", "name": "航太與國防", "sector": "工業", "blurb": "關鍵零件、國防主承包商，到航空公司",
        "stages": ["零組件", "主承包商", "航空運輸"],
        "nodes": [
            {"id": "parts", "name": "航太零組件", "stage": 0, "stocks": [("HWM", "Howmet"), ("HEI", "HEICO"), ("TDG", "TransDigm")]},
            {"id": "prime", "name": "主承包商", "stage": 1, "stocks": [("LMT", "洛克希德馬丁"), ("RTX", "雷神"), ("NOC", "諾斯洛普"), ("GD", "通用動力"), ("BA", "波音"), ("LHX", "L3Harris")]},
            {"id": "air", "name": "航空公司", "stage": 2, "stocks": [("DAL", "達美"), ("UAL", "聯合航空"), ("LUV", "西南航空"), ("AAL", "美國航空")]},
        ],
        "edges": [("parts", "prime"), ("prime", "air")],
    },
]
