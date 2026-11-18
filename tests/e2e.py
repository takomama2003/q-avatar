"""真实浏览器回归：开发服务器需运行于 127.0.0.1:5173。结果写入 artifacts/test-results.json。
所有 /api 请求都被拦截：演示模式直接跑，真实模式用模拟的后端响应，不会调用真实模型，也不花钱。"""
import base64
import datetime
import hashlib
import json
import re
import tempfile
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
SITE = "http://127.0.0.1:5173"
checks = []
def passed(name):
    checks.append(name)
    print("PASS:", name)

def multipart_fields(request):
    """按 boundary 拆开浏览器发出的 multipart 请求，返回 {字段名: (文件名, 类型, 内容字节)}。"""
    boundary = re.search(r"boundary=([^;]+)", request.headers["content-type"]).group(1).strip('"').encode()
    fields = {}
    for part in request.post_data_buffer.split(b"--" + boundary)[1:-1]:
        head, _, body = part.strip(b"\r\n").partition(b"\r\n\r\n")
        text = head.decode("utf-8", "replace")
        name = re.search(r'; name="([^"]*)"', text).group(1)
        filename = re.search(r'filename="([^"]*)"', text)
        kind = re.search(r"(?im)^content-type:\s*(\S+)", text)
        fields[name] = (filename and filename.group(1), kind and kind.group(1), body)
    return fields

def text_field(fields, name):
    return fields[name][2].decode("utf-8")

def source_digests():
    files = [ROOT / "index.html", Path(__file__).resolve()]
    for folder in ("src", "public", "server", "shared"):
        files += sorted(p for p in (ROOT / folder).rglob("*") if p.is_file())
    return {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}

STORED = """() => new Promise(resolve => { const open = indexedDB.open('tim-pet'); open.onsuccess = () => {
  const db = open.result; if (!db.objectStoreNames.contains('works')) return resolve([]);
  const req = db.transaction('works').objectStore('works').getAll();
  req.onsuccess = () => resolve(req.result.map(r => ({ keys: Object.keys(r).sort(), type: r.blob.type, size: r.blob.size, source: r.source, composition: r.options.composition, style: r.options.style }))) } })"""

def run():
    with tempfile.TemporaryDirectory() as directory, sync_playwright() as playwright:
        fixtures = Path(directory)
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1120}, accept_downloads=True)
        # 默认把 /api 全部挡掉：即使本机 .env 配了密钥，回归测试也只跑演示模式，不花钱。
        context.route("**/api/**", lambda route: route.fulfill(status=404, json={"error": "blocked in tests"}))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        def screenshot(name, target=None):
            # 回到顶部、等异步字体加载完，并跳过入场动画，截图才稳定。
            target = target or page
            target.wait_for_load_state("networkidle")
            target.evaluate("scrollTo(0, 0)")
            target.evaluate("document.fonts.ready.then(() => true)")
            target.screenshot(path=str(ARTIFACTS / name), full_page=True, animations="disabled")
        nav = page.get_by_role("navigation", name="主导航")

        page.goto(SITE)
        page.get_by_role("heading", level=1, name="把日常的你，装进小小世界。").wait_for()
        assert page.locator(".step-card").count() == 4
        assert page.locator(".series-card").count() == 5
        assert page.locator(".shelf .sample-card").count() == 2, "没有作品时展示柜显示官方示例"
        screenshot("home-desktop.png")
        page.locator("main").get_by_role("link", name="开始创作", exact=True).click()
        page.get_by_role("heading", name="创作设置").wait_for()
        assert page.url.endswith("/studio")
        page.go_back()
        page.get_by_role("link", name="用黏土小人系列开始创作").click()
        page.get_by_role("heading", name="创作设置").wait_for()
        page.wait_for_function("location.search === ''")
        assert page.get_by_role("button", name="黏土小人").get_attribute("aria-pressed") == "true"
        assert page.title() == "创作工坊 · Tim_pet"
        passed("首页：四步、五个系列、展示柜示例；入口和系列卡片带着风格进入工坊")

        page.get_by_role("button", name="3D 公仔").click()
        assert page.get_by_role("button", name="生成我的公仔 · 示例").is_disabled()
        assert page.get_by_role("button", name="头像", exact=False).get_attribute("aria-pressed") == "true"
        assert page.get_by_role("button", name="挥手").is_disabled(), "头像构图下姿势不可选"
        assert page.get_by_role("button", name="Q 版 · 2.5 头身").is_disabled(), "头像构图下头身比不可选"
        assert page.get_by_role("button", name="轻 Q · 约 4 头身").get_attribute("aria-pressed") == "true", "默认轻 Q"
        assert page.get_by_role("button", name="1 张", exact=True).get_attribute("aria-pressed") == "true"
        screenshot("studio-empty.png")
        passed("工坊初始状态：默认头像、轻 Q、1 张、头像下姿势和头身比不可选、未上传不能生成")

        # 从浏览器画布取得有效 PNG，不依赖外部图片。
        png = page.evaluate("""() => { const c=document.createElement('canvas'); c.width=160;c.height=200;const x=c.getContext('2d');x.fillStyle='#b9a0cf';x.fillRect(0,0,160,200);x.fillStyle='#f5d2ae';x.beginPath();x.arc(80,80,40,0,Math.PI*2);x.fill();return c.toDataURL('image/png').split(',')[1] }""")
        image = fixtures / "photo.png"
        image.write_bytes(base64.b64decode(png))
        upload = page.get_by_label("上传照片", exact=True)
        upload.set_input_files(str(image))
        page.get_by_alt_text("上传照片预览").wait_for()
        original = page.get_by_alt_text("上传照片预览").get_attribute("src")
        passed("有效 PNG 上传与预览")

        def invalid(payload, message):
            upload.set_input_files(payload)
            page.get_by_role("alert").filter(has_text=message).wait_for()
            assert page.get_by_alt_text("上传照片预览").get_attribute("src") == original
        invalid({"name":"bad.txt","mimeType":"text/plain","buffer":b"bad"}, "请选择")
        invalid({"name":"broken.png","mimeType":"image/png","buffer":b"broken"}, "无法读取")
        invalid({"name":"large.png","mimeType":"image/png","buffer":b"0"*(10*1024*1024+1)}, "不能超过")
        page.locator(".photo-row").evaluate("""el => { const dt=new DataTransfer();dt.items.add(new File(['a'],'a.png',{type:'image/png'}));dt.items.add(new File(['b'],'b.png',{type:'image/png'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt})); }""")
        page.get_by_role("alert").filter(has_text="一次选择一张").wait_for()
        assert page.get_by_alt_text("上传照片预览").get_attribute("src") == original
        assert page.get_by_role("button", name="重试示例生成").count() == 0
        passed("格式、损坏图片、超限、多文件：拒绝且保留有效预览，不显示重试")

        # 生成中切到别的页面：导航栏显示进度，生成好后弹出提示，照片和结果都还在。
        held = []
        page.route("**/samples/portrait.png", lambda route: held.append(route))
        page.get_by_role("button", name="生成我的公仔 · 示例").click()
        for _ in range(100):  # 等示例图请求被拦住（演示模式先等 0.9 秒）
            if held: break
            page.wait_for_timeout(50)
        assert held, "示例图请求没有发出"
        nav.get_by_role("link", name="作品画廊").click()
        page.get_by_role("heading", name="作品画廊").wait_for()
        nav.locator(".nav-flag.busy").wait_for()
        held.pop().fulfill(path=str(ROOT / "public" / "samples" / "portrait.png"), content_type="image/png")
        page.unroute("**/samples/portrait.png")
        page.get_by_role("status").filter(has_text="你的公仔生成好了").wait_for()
        page.get_by_role("link", name="去看看").click()
        page.get_by_role("heading", name="创作设置").wait_for()
        page.get_by_role("link", name="下载示例").wait_for()
        assert page.get_by_alt_text("上传照片预览").get_attribute("src") == original
        assert page.get_by_text("你的公仔生成好了").count() == 0
        passed("生成中切换页面：导航显示进度，完成后提示并回到工坊，照片和结果保留")
        stray = page.evaluate("""() => { const dt=new DataTransfer();dt.items.add(new File(['a'],'a.png',{type:'image/png'}));return ['dragover','drop'].map(type => { const e=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt});document.body.dispatchEvent(e);return e.defaultPrevented }) }""")
        assert stray == [True, True], stray
        assert page.get_by_alt_text("上传照片预览").get_attribute("src") == original
        passed("拖到上传区以外：阻止浏览器打开图片，保留预览")

        description = page.get_by_role("textbox", name="补充描述")
        description.fill("想" * 205)
        assert len(description.input_value()) == 200
        page.get_by_role("button", name="全身", exact=False).click()
        assert page.get_by_role("button", name="挥手").is_enabled(), "全身构图下可以选姿势"
        description.fill("抱着小猫的公仔")
        page.get_by_role("button", name="重新生成示例").click()
        assert page.get_by_role("button", name="正在准备示例…").is_disabled()
        assert description.is_disabled()
        download = page.get_by_role("link", name="下载示例")
        page.wait_for_function("document.querySelector('.comparison a')?.download.endsWith('full.png')")
        assert page.get_by_alt_text("原图对比").is_visible()
        passed("描述 200 字限制、全身示例、姿势随构图启用、生成锁定和原图对比")
        with page.expect_download() as event:
            download.click()
        item = event.value
        target = fixtures / item.suggested_filename
        item.save_as(target)
        assert target.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
        passed("实际下载 PNG 示例")

        page.get_by_role("button", name="头像", exact=False).click()
        page.get_by_role("button", name="重新生成示例").click()
        page.wait_for_function("document.querySelector('.comparison a')?.download.endsWith('portrait.png')")
        passed("重新生成采用当前构图")

        page.route("**/samples/portrait.png", lambda route: route.fulfill(status=503, body="unavailable"))
        page.get_by_role("button", name="重新生成示例").click()
        page.get_by_role("alert").filter(has_text="加载失败").wait_for()
        assert description.input_value() == "抱着小猫的公仔"
        assert page.get_by_alt_text("上传照片预览").is_visible()
        assert download.is_visible()
        page.unroute("**/samples/portrait.png")
        page.get_by_role("button", name="重试示例生成").click()
        page.get_by_role("status").filter(has_text="示例已准备好").wait_for()
        passed("服务失败保留输入及上次结果，手动重试成功")

        page.get_by_role("button", name="3 张", exact=True).click()
        page.get_by_role("button", name="重新生成 3 张示例").click()
        page.get_by_role("status").filter(has_text="3 张示例已准备好").wait_for()
        thumbs = page.get_by_role("group", name="选择一张").get_by_role("button")
        assert thumbs.count() == 3
        thumbs.nth(2).click()
        assert thumbs.nth(2).get_attribute("aria-pressed") == "true"
        assert page.locator(".comparison a").get_attribute("download") == "Tim_pet-demo-portrait-3.png"
        screenshot("studio-result.png")
        page.get_by_role("button", name="1 张", exact=True).click()
        passed("一次生成 3 张：缩略图切换，下载文件名带序号")

        nav.get_by_role("link", name="作品画廊").click()
        page.get_by_role("heading", name="作品画廊").wait_for()
        cards = page.locator(".work-card")
        cards.first.wait_for()
        stored = page.evaluate(STORED)
        assert cards.count() == len(stored) >= 7, (cards.count(), len(stored))
        assert all(r["keys"] == ["blob", "createdAt", "extension", "id", "model", "options", "source"] and r["type"] == "image/png" and r["size"] > 0 for r in stored), stored[:1]
        assert all(r["source"] == "demo" for r in stored)
        assert page.evaluate("localStorage.length + sessionStorage.length") == 0
        assert page.locator(".work-badge").first.inner_text() == "示例"
        screenshot("gallery-desktop.png")
        passed("作品画廊：每张结果存进本机记录，只存结果图和设置、不存原照片")

        cards.filter(has_text="全身").first.click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("button", name="用同样的设置再做").click()
        page.get_by_role("heading", name="创作设置").wait_for()
        assert page.get_by_role("button", name="全身", exact=False).get_attribute("aria-pressed") == "true"
        assert page.get_by_role("textbox", name="补充描述").input_value() == "抱着小猫的公仔"
        passed("画廊里“用同样的设置再做”：回到工坊并套用构图和描述")
        nav.get_by_role("link", name="作品画廊").click()
        cards.first.wait_for()
        before = cards.count()
        page.reload()
        cards.first.wait_for()
        assert cards.count() == before, "刷新后作品记录还在"
        cards.first.click()
        dialog.get_by_role("button", name="删除").click()
        dialog.get_by_role("button", name="确认删除").click()
        page.wait_for_function(f"document.querySelectorAll('.work-card').length === {before - 1}")
        page.get_by_role("button", name="清空全部").click()
        page.get_by_role("button", name="确认清空").click()
        page.get_by_text("展示柜还是空的").wait_for()
        assert page.evaluate(STORED) == []
        page.get_by_role("button", name="官方示例").click()
        assert page.locator(".sample-card").count() == 2
        passed("作品记录：刷新后保留，可以删除单张、清空全部；官方示例单独一栏")

        nav.get_by_role("link", name="帮助").click()
        page.get_by_role("heading", name="使用说明书").wait_for()
        assert page.get_by_role("navigation", name="本页目录").get_by_role("link").count() == 7
        assert page.locator(".error-table tbody tr").count() >= 8
        page.get_by_role("navigation", name="本页目录").get_by_role("link", name="费用说明").click()
        page.wait_for_function("location.hash === '#billing'")
        first_faq = page.locator("#faq details").first
        first_faq.locator("summary").click()
        assert first_faq.get_attribute("open") is not None
        screenshot("help-desktop.png")
        page.goto(f"{SITE}/no-such-page")
        page.get_by_role("heading", name="这个盒子是空的").wait_for()
        page.get_by_role("link", name="回到首页").click()
        page.get_by_role("heading", level=1, name="把日常的你，装进小小世界。").wait_for()
        passed("帮助页目录、报错表和问答可用；不存在的地址显示 404 并能回到首页")

        replacement = fixtures / "replacement.png"
        replacement.write_bytes(image.read_bytes())
        page.goto(f"{SITE}/studio")
        page.get_by_role("heading", name="创作设置").wait_for()
        upload.set_input_files(str(image))
        page.get_by_alt_text("上传照片预览").wait_for()
        page.get_by_role("button", name="生成我的公仔 · 示例").click()
        page.get_by_role("link", name="下载示例").wait_for()
        upload.set_input_files(str(replacement))
        page.wait_for_function("document.querySelector('.photo-row strong')?.textContent === 'replacement.png'")
        assert page.get_by_role("link", name="下载示例").count() == 0
        page.get_by_role("button", name="删除照片").click()
        assert page.get_by_alt_text("上传照片预览").count() == 0
        upload.set_input_files(str(image))
        page.get_by_alt_text("上传照片预览").wait_for()
        page.reload()
        page.get_by_role("button", name="点击上传，或拖入照片").wait_for()
        assert page.get_by_alt_text("上传照片预览").count() == 0
        assert page.evaluate("localStorage.length + sessionStorage.length") == 0
        passed("更换清除旧结果、删除、刷新不恢复照片")

        page.set_viewport_size({"width": 375, "height": 812})
        page.goto(SITE)
        page.get_by_role("heading", level=1).wait_for()
        assert not nav.is_visible(), "手机上导航收进菜单"
        page.get_by_role("button", name="打开菜单").click()
        nav.get_by_role("link", name="帮助").click()
        page.get_by_role("heading", name="使用说明书").wait_for()
        assert not nav.is_visible(), "点完链接菜单自动收起"
        for path in ("/", "/gallery", "/help"):
            page.goto(SITE + path)
            page.get_by_role("heading", level=1).wait_for()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), path
        page.goto(f"{SITE}/studio")
        page.get_by_role("heading", name="创作设置").wait_for()
        upload.set_input_files(str(image))
        page.get_by_alt_text("上传照片预览").wait_for()
        page.get_by_role("button", name="生成我的公仔 · 示例").click()
        page.get_by_role("link", name="下载示例").wait_for()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        screenshot("mobile-result.png")
        page.get_by_role("button", name="删除照片").click()
        page.goto(SITE)
        page.get_by_role("heading", level=1).wait_for()
        screenshot("mobile-home.png")
        passed("375px 手机：菜单开合、各页无横向溢出，上传、生成、删除")
        page.set_viewport_size({"width": 1440, "height": 1120})

        # 真实模式：模拟后端接口，检查前端发送的内容和界面文案（不调用真实模型）。
        data_url = "data:image/png;base64," + base64.b64encode(image.read_bytes()).decode()
        real = context.new_page()
        real.on("pageerror", lambda error: errors.append(str(error)))
        held = []
        real.route("**/api/config", lambda route: route.fulfill(json={"enabled": True, "model": "gpt-image-2"}))
        real.route("**/api/generate", lambda route: held.append(route))
        real.goto(f"{SITE}/studio")
        real.locator(".demo-tag.live").filter(has_text="gpt-image-2").wait_for()
        assert "发给" in real.locator(".privacy").inner_text()
        assert real.get_by_text("照片和描述会发给 gpt-image-2").is_visible()
        real.get_by_label("上传照片", exact=True).set_input_files(str(image))
        real.get_by_alt_text("上传照片预览").wait_for()
        for choice in ("黏土小人", "竖图 2:3", "眨眼", "淡紫"):
            real.get_by_role("button", name=choice).click()
        real.get_by_role("button", name="3 张", exact=True).click()
        real.get_by_role("textbox", name="补充描述").fill("戴红色围巾")
        with real.expect_request("**/api/generate") as sent:
            real.get_by_role("button", name="生成 3 张公仔", exact=True).click()
        assert real.get_by_role("button", name="正在生成…").is_disabled()
        assert "生成中" in real.locator(".unboxing").inner_text()
        fields = multipart_fields(sent.value)
        # Chromium 拦截到的请求里不含文件内容（只有文件名和类型）；文件字节由 tests/server.test.mjs 检查。
        assert fields["photo"][:2] == ("photo.png", "image/png"), fields["photo"][:2]
        expected = {"style": "clay", "composition": "portrait", "ratio": "tall", "expression": "wink", "background": "lilac", "count": "3", "description": "戴红色围巾"}
        assert {name: text_field(fields, name) for name in expected} == expected
        held.pop().fulfill(json={"images": [data_url, data_url], "failed": 1, "warning": "有 1 张没有生成成功：请求太频繁或账户额度不足，请稍后再试，或检查账户余额。"})
        real.get_by_role("link", name="下载图片").wait_for()
        assert real.get_by_role("group", name="选择一张").get_by_role("button").count() == 2
        real.get_by_role("button", name="第 2 张").click()
        assert real.get_by_role("link", name="下载图片").get_attribute("download") == "Tim_pet-portrait-2.png"
        assert real.get_by_alt_text("根据上传照片生成的头像公仔").is_visible()
        assert real.locator(".sticker.live").inner_text().startswith("AI 款")
        assert "bg-lilac" in real.locator(".window").get_attribute("class")
        status = real.get_by_role("status")
        status.filter(has_text="由 gpt-image-2 生成").wait_for()
        assert "有 1 张没有生成成功" in status.inner_text()
        screenshot("studio-real.png", real)
        passed("真实模式（模拟后端）：发送风格、比例、表情、背景、数量和描述；部分失败时显示成功的几张并提示")

        real.get_by_role("button", name="全身", exact=False).click()
        real.get_by_role("button", name="跳起来").click()
        real.get_by_role("button", name="Q 版 · 2.5 头身").click()
        real.get_by_role("button", name="1 张", exact=True).click()
        with real.expect_request("**/api/generate") as sent:
            real.get_by_role("button", name="重新生成", exact=True).click()
        fields = multipart_fields(sent.value)
        sent_fields = tuple(text_field(fields, name) for name in ("composition", "pose", "proportion", "count"))
        assert sent_fields == ("full", "jump", "chibi", "1"), sent_fields
        held.pop().fulfill(json={"images": [data_url], "failed": 0})
        real.wait_for_function("document.querySelector('.comparison a')?.download === 'Tim_pet-full.png'")
        assert real.get_by_role("group", name="选择一张").count() == 0
        real.unroute("**/api/generate")
        real.route("**/api/generate", lambda route: route.fulfill(status=502, json={"error": "API 密钥无效或已过期，请检查 .env 里的 OPENAI_API_KEY。"}))
        real.get_by_role("button", name="重新生成", exact=True).click()
        real.get_by_role("alert").filter(has_text="API 密钥无效").wait_for()
        assert real.get_by_role("button", name="重试生成", exact=True).is_visible()
        assert real.get_by_role("link", name="下载图片").is_visible()
        for _ in range(40):
            models = [r for r in real.evaluate(STORED) if r["source"] == "model"]
            if len(models) == 3: break
            real.wait_for_timeout(50)
        assert len(models) == 3 and {r["style"] for r in models} == {"clay"}, models
        real.close()
        passed("真实模式：姿势和头身比随全身构图发送、结果存进记录、失败保留上次结果并可重试")

        misconfigured = context.new_page()
        misconfigured.on("pageerror", lambda error: errors.append(str(error)))
        misconfigured.route("**/api/config", lambda route: route.fulfill(json={"enabled": False, "problem": "OPENAI_IMAGE_QUALITY 只能是 low、medium、high 或 auto。"}))
        misconfigured.goto(f"{SITE}/studio")
        misconfigured.get_by_role("status").filter(has_text="OPENAI_IMAGE_QUALITY").wait_for()
        assert misconfigured.locator(".demo-tag").inner_text() == "前端演示版"
        misconfigured.close()
        passed("配置有误时回到演示模式并提示原因")

        # 中转常用带前缀、日期的长模型名：手机宽度下也不能撑出横向滚动。
        narrow = context.new_page()
        narrow.set_viewport_size({"width": 375, "height": 812})
        narrow.on("pageerror", lambda error: errors.append(str(error)))
        long_model = "openai/gpt-image-2-2026-04-21-preview"
        narrow.route("**/api/config", lambda route: route.fulfill(json={"enabled": True, "model": long_model}))
        narrow.route("**/api/generate", lambda route: route.fulfill(json={"images": [data_url], "failed": 0}))
        narrow.goto(f"{SITE}/studio")
        narrow.locator(".demo-tag.live").wait_for()
        narrow.get_by_label("上传照片", exact=True).set_input_files(str(image))
        narrow.get_by_alt_text("上传照片预览").wait_for()
        narrow.get_by_role("button", name="生成我的公仔", exact=True).click()
        narrow.get_by_role("link", name="下载图片").wait_for()
        assert narrow.evaluate("document.documentElement.scrollWidth <= innerWidth"), narrow.evaluate("document.documentElement.scrollWidth")
        narrow.close()
        passed("真实模式长模型名：375px 无横向溢出")
        assert not errors, errors
        passed("无未捕获浏览器运行错误")
        context.close()
        browser.close()

failed = []
try:
    run()
except BaseException as error:
    frame = next((f for f in reversed(traceback.extract_tb(error.__traceback__)) if Path(f.filename).resolve() == Path(__file__).resolve()), None)
    detail = (str(error).strip().splitlines() or [""])[0]
    failed.append(f"第 {frame.lineno if frame else '?'} 行 {type(error).__name__}: {detail}")
    raise
finally:
    report = {"passed": checks, "failed": failed, "date": datetime.date.today().isoformat(), "source_sha256": source_digests()}
    (ARTIFACTS / "test-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{len(checks)} 组端到端检查通过")
