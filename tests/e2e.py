"""浏览器完整流程：注册 → 换头像 → 兑换 → 生成 → 顶栏菜单退出 → 后台（弹窗）→ 忘记密码 → 协议页。

跑在“本机试用环境”上：正式后端 server/production.ts + 假模型服务 + 发 dist/ 的静态服务器，不调用真实模型，不花钱。
准备步骤见 README 的“检查”一节。用法：
  python tests/e2e.py <网站地址> <截图目录> <3 张的兑换码> <管理员 tim 的密码> <一张照片> <新用户名>
手机号从 .env.production.local 的 VITE_CONTACT_PHONE 读取（不写进仓库）；没配置时只检查联系卡能显示。
"""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base, shots, voucher, admin_pw, photo, user = sys.argv[1:7]
env_file = Path(__file__).resolve().parents[1] / ".env.production.local"
phone = next((line.split("=", 1)[1].strip() for line in (env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []) if line.startswith("VITE_CONTACT_PHONE=")), "")
phone_shown = f"{phone[:3]} {phone[3:7]} {phone[7:]}" if len(phone) == 11 else phone
results = []
def ok(name): results.append(name); print('PASS', name)

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge")
    page = browser.new_page(viewport={"width": 1366, "height": 900})
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))

    # 1. 没登录：工坊能传照片，按钮是“登录后生成”，点了去登录页
    page.goto(base + "/studio", wait_until="networkidle")
    expect(page.locator(".stage .stage-image")).to_be_visible()
    page.set_input_files("input[type=file]", photo)
    page.wait_for_selector(".photo-row")
    expect(page.locator(".generate")).to_have_text("登录后生成")
    page.click(".generate")
    page.wait_for_url(re.compile(r"/login\?redirect=(%2F|/)studio"))
    ok("未登录也能传照片，生成按钮引导去登录")

    # 2. 注册：要勾选同意协议
    page.click("button[role=tab]:has-text('注册')")
    page.fill("input[name=username]", user)
    page.fill("input[name=password]", "password123")
    page.fill("input[name=confirm]", "password123")
    page.click(".login-submit")
    expect(page.locator(".ui-alert.err")).to_contain_text("用户协议")
    page.check(".login-privacy input[type=checkbox]")
    page.click(".login-submit")
    page.wait_for_url(re.compile(r"/studio$"))
    expect(page.locator(".credit-token")).to_contain_text("0")
    expect(page.locator(".photo-row")).to_be_visible()
    ok("注册要同意协议；注册后回到工坊，照片还在，顶栏 0 张")

    # 3. 没张数：提示购买，显示客服联系卡（二维码 + 手机号）
    page.click(".generate")
    expect(page.locator(".ui-alert.err")).to_contain_text("张数用完了")
    expect(page.locator(".studio-buy .contact-card")).to_be_visible()
    if phone_shown: expect(page.locator(".studio-buy")).to_contain_text(phone_shown)
    ok("没张数时提示购买并显示客服二维码和手机号")

    # 4. 换头像
    page.goto(base + "/account", wait_until="networkidle")
    page.click(".avatar-edit")
    expect(page.locator(".ui-modal")).to_be_visible()
    page.click(".avatar-option:has-text('戴耳机')")
    expect(page.locator(".ui-modal")).to_have_count(0)
    page.reload(wait_until="networkidle")
    expect(page.locator(".avatar-button .chibi-avatar")).to_be_visible()
    page.click(".avatar-edit")
    expect(page.locator(".avatar-option.selected")).to_contain_text("戴耳机")
    page.keyboard.press("Escape")
    expect(page.locator(".ui-modal")).to_have_count(0)
    ok("换头像后刷新还在；弹窗 Esc 关闭")

    # 5. 兑换
    page.fill("input[name=code]", voucher)
    page.click(".account-redeem button")
    expect(page.locator(".account-redeem .ui-alert.ok")).to_contain_text("领到 3 张")
    expect(page.locator(".credit-token")).to_contain_text("3")
    page.fill("input[name=code]", voucher)
    page.click(".account-redeem button")
    expect(page.locator(".account-redeem .ui-alert.err")).to_contain_text("已经兑换过")
    ok("兑换 3 张；同一个码不能再兑换")

    # 6. 生成 2 张，扣到 1；结果带 AI 生成标识
    page.goto(base + "/studio", wait_until="networkidle")
    # 整页刷新后照片不保留（照片不存），重新上传
    page.set_input_files("input[type=file]", photo)
    page.wait_for_selector(".photo-row")
    page.click(".segmented button:has-text('2 张')")
    page.click(".generate")
    expect(page.locator(".studio-status")).to_contain_text("你还剩 1 张", timeout=20000)
    expect(page.locator(".credit-token")).to_contain_text("1")
    expect(page.locator(".stage .ai-mark")).to_have_text("AI 生成")
    expect(page.locator(".thumbs .thumb")).to_have_count(2)
    page.screenshot(path=f"{shots}/studio-result.png", full_page=True)
    ok("生成 2 张，余额 3 → 1，结果标有 AI 生成")

    # 7. 普通用户进不了后台
    page.goto(base + "/admin", wait_until="networkidle")
    expect(page.locator(".gallery-empty")).to_contain_text("只有管理员")
    ok("普通用户看不到后台")

    # 8. 从顶栏头像菜单退出
    page.click(".avatar-button")
    expect(page.locator("#account-menu")).to_be_visible()
    expect(page.locator("#account-menu")).not_to_contain_text("管理后台")
    page.click("#account-menu button:has-text('退出登录')")
    page.wait_for_url(re.compile(r"/$"))
    expect(page.locator(".header-login")).to_be_visible()
    ok("从顶栏头像菜单退出登录")

    # 9. 管理员登录，后台默认是兑换码；新建兑换码（弹窗），只显示一次
    page.goto(base + "/login?redirect=/admin", wait_until="networkidle")
    page.fill("input[name=username]", "tim")
    page.fill("input[name=password]", admin_pw)
    page.click(".login-submit")
    page.wait_for_url(re.compile(r"/admin$"))
    expect(page.locator("#vouchers-title")).to_be_visible()
    page.click("button:has-text('新建兑换码')")
    page.fill(".ui-modal input[type=number] >> nth=0", "50")
    page.fill(".ui-modal input[type=text]", "微信 测试 11-21")
    page.click(".ui-modal-foot button:has-text('生成兑换码')")
    code = page.locator("code.ui-secret").inner_text()
    assert re.fullmatch(r"[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}", code), code
    page.screenshot(path=f"{shots}/admin-voucher-secret.png")
    page.click(".ui-modal-foot button:has-text('我已保存')")
    expect(page.locator(".admin-table")).to_contain_text("微信 测试 11-21")
    page.screenshot(path=f"{shots}/admin-vouchers.png", full_page=True)
    ok("后台在弹窗里新建兑换码，只显示一次，列表有客户备注")

    # 10. 用户：调张数（弹窗），更多菜单里看生成记录
    page.click(".admin-nav button:has-text('用户')")
    row = page.locator("tr", has_text=user)
    expect(row.locator("td.num").first).to_have_text("1")
    row.locator("button:has-text('调张数')").click()
    page.fill(".ui-modal input[type=number]", "5")
    page.fill(".ui-modal input[type=text]", "测试补偿")
    page.click(".ui-modal-foot button:has-text('保存')")
    expect(page.locator(".admin-main .ui-alert.ok")).to_contain_text("现在有 6 张")
    expect(row.locator("td.num").first).to_have_text("6")
    page.screenshot(path=f"{shots}/admin-users.png", full_page=True)
    row.locator(".row-more").click()
    expect(row.locator(".ui-menu")).to_be_visible()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Escape")
    expect(row.locator(".ui-menu")).to_have_count(0)
    row.locator(".row-more").click()
    row.locator(".ui-menu button:has-text('看生成记录')").click()
    expect(page.locator("#gens-title")).to_be_visible()
    expect(page.locator(".admin-toolbar")).to_contain_text(f"只看 {user}")
    expect(page.locator(".admin-table")).to_contain_text(user)
    ok("调张数用弹窗；更多菜单键盘可关；看该用户的生成记录")

    # 11. 统计页
    page.click(".admin-nav button:has-text('用量统计')")
    expect(page.locator(".stat-tiles")).to_be_visible()
    page.screenshot(path=f"{shots}/admin-stats.png", full_page=True)
    ok("用量统计能打开")

    # 12. 改别人密码（弹窗），用户用新密码登录
    page.click(".admin-nav button:has-text('用户')")
    row = page.locator("tr", has_text=user)
    row.locator(".row-more").click()
    row.locator(".ui-menu button:has-text('设新密码')").click()
    page.fill(".ui-modal input[type=password] >> nth=0", "newpassword456")
    page.fill(".ui-modal input[type=password] >> nth=1", "newpassword456")
    page.click(".ui-modal-foot button:has-text('保存')")
    expect(page.locator(".admin-main .ui-alert.ok")).to_contain_text("已修改")
    u = browser.new_page(viewport={"width": 1366, "height": 900})
    u.goto(base + "/login?redirect=/account", wait_until="networkidle")
    u.fill("input[name=username]", user)
    u.fill("input[name=password]", "newpassword456")
    u.click(".login-submit")
    u.wait_for_url(re.compile(r"/account$"))
    expect(u.locator(".account-stat strong").first).to_have_text("6")
    expect(u.locator(".ui-list")).to_contain_text("客服调整")
    expect(u.locator(".ui-list")).not_to_contain_text("测试补偿")
    u.screenshot(path=f"{shots}/account-after.png", full_page=True)
    ok("管理员设的新密码能登录；用户看到客服调整，看不到内部备注")

    # 13. 忘记密码弹窗显示客服联系方式
    v = browser.new_page(viewport={"width": 1366, "height": 900})
    v.goto(base + "/login", wait_until="networkidle")
    v.click("button:has-text('忘记密码')")
    expect(v.locator(".ui-modal .contact-card")).to_be_visible()
    if phone_shown: expect(v.locator(".ui-modal")).to_contain_text(phone_shown)
    ok("忘记密码弹窗显示客服二维码和手机号")

    # 14. 协议和隐私页能打开，页脚有链接
    v.keyboard.press("Escape")
    v.click(".footer-legal a:has-text('用户协议')")
    v.wait_for_url(re.compile(r"/terms$"))
    expect(v.locator("h1")).to_have_text("用户协议")
    v.goto(base + "/privacy", wait_until="networkidle")
    expect(v.locator("h1")).to_have_text("隐私政策")
    ok("用户协议和隐私政策能打开")

    print("console errors:", errors[:5])
    browser.close()
print(f"\n{len(results)}/14 通过")
