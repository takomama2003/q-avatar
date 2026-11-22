<script setup lang="ts">
import { CONTACT } from '../content/contact'

// 用户协议（草稿）：只按网站实际的做法写，正式对外前需要专业人士审核。
const sections = [
  { id: 'service', title: '服务内容' },
  { id: 'account', title: '账号' },
  { id: 'credits', title: '兑换码和张数' },
  { id: 'content', title: '上传内容的要求' },
  { id: 'output', title: '生成结果' },
  { id: 'limits', title: '服务的限制' },
  { id: 'contact', title: '联系我们' },
]
</script>

<template>
  <div class="container ui-page help-page">
    <header class="ui-page-head reveal" style="--i: 0">
      <div>
        <h1>用户协议</h1>
        <p>注册和使用 Tim_pet 前请阅读。</p>
      </div>
    </header>
    <div class="help-layout">
      <nav class="help-toc" aria-label="本页目录">
        <a v-for="section in sections" :key="section.id" :href="`#${section.id}`">{{ section.title }}</a>
      </nav>
      <div class="help-content">
        <p class="ui-alert warn legal-draft" role="note">本协议为草稿版本，正式对外提供服务前会经专业人士审核后更新。</p>

        <section id="service" class="help-section" aria-labelledby="service-title">
          <h2 id="service-title">一、服务内容</h2>
          <p>Tim_pet 根据你上传的照片和选择的风格，使用人工智能图像模型生成 Q 版公仔风格的图片。生成结果由模型自动产生，本站不做人工修改。</p>
        </section>

        <section id="account" class="help-section" aria-labelledby="account-title">
          <h2 id="account-title">二、账号</h2>
          <ul>
            <li>注册只需要用户名和密码。请妥善保管密码，不要把账号借给他人。</li>
            <li>忘记密码时，请联系客服核对后重置。</li>
            <li>如果账号被用于违反本协议的用途，本站可以停用该账号。</li>
          </ul>
        </section>

        <section id="credits" class="help-section" aria-labelledby="credits-title">
          <h2 id="credits-title">三、兑换码和张数</h2>
          <ul>
            <li>张数通过兑换码获得。兑换码向客服购买，每个兑换码只能使用一次。</li>
            <li>生成 1 张图使用 1 张额度。没有生成出来的张数会自动退回账户。</li>
            <li>兑换后的张数没有使用期限，不能转让给其他账号，也不能兑换成现金。</li>
            <li>兑换码售出后，已兑换的张数原则上不退款；如果因本站原因长期无法使用，请联系客服协商处理。</li>
          </ul>
        </section>

        <section id="content" class="help-section" aria-labelledby="content-title">
          <h2 id="content-title">四、上传内容的要求</h2>
          <ul>
            <li>请只上传你本人的照片，或者已经得到照片中人物同意的照片；未成年人的照片应由监护人上传。</li>
            <li>不得上传或描述违法违规、色情暴力、侵犯他人肖像权、隐私或其他合法权益的内容。</li>
            <li>不得利用生成结果冒充他人、制造虚假信息或用于其他违法用途。</li>
          </ul>
        </section>

        <section id="output" class="help-section" aria-labelledby="output-title">
          <h2 id="output-title">五、生成结果</h2>
          <ul>
            <li>生成的图片供你个人使用。请不要删除或遮挡图片上的“AI 生成”标识，转发时请说明是 AI 生成的内容。</li>
            <li>本站服务器不保存生成的图片，作品只存在你的浏览器里，请及时下载。浏览器数据被清除后无法找回。</li>
            <li>AI 生成的结果可能和照片本人不完全相像，也可能出现瑕疵，这不视为服务故障；没有生成出来的张数会自动退回。</li>
          </ul>
        </section>

        <section id="limits" class="help-section" aria-labelledby="limits-title">
          <h2 id="limits-title">六、服务的限制</h2>
          <ul>
            <li>为保证服务稳定，全站每天的生成数量有上限，达到上限后当天暂停生成。</li>
            <li>本站可能因维护、上游模型服务故障等原因暂停服务，会尽量提前告知。</li>
            <li>本协议更新时，会在本页公布新版本。</li>
          </ul>
        </section>

        <section id="contact" class="help-section" aria-labelledby="contact-title">
          <h2 id="contact-title">七、联系我们</h2>
          <p>对本协议或服务有任何问题，请联系客服<template v-if="CONTACT.phone">（手机 {{ CONTACT.phoneDisplay }}，或扫描<RouterLink to="/help#buy" class="link-inline">帮助页</RouterLink>上的微信二维码）</template>。</p>
        </section>
      </div>
    </div>
  </div>
</template>
