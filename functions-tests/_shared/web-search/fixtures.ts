/** 模拟必应 RSS 真实结构：含实体编码、非法协议、缺字段与超量条目（域名各不相同，模拟自然多样性） */
export const sampleRss = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<rss version="2.0"><channel>',
  "<title>上海天气 - Bing</title>",
  '<link>https://www.bing.com/search?q=%E4%B8%8A%E6%B5%B7%E5%A4%A9%E6%B0%94</link>',
  "<description>bing</description>",
  "<item><title>上海今日天气 &amp; 空气质量</title><link>https://weather.example.cn/a?x=1&amp;y=2</link><description>今日多云 &lt;24 至 30 度&gt;</description></item>",
  "<item><title>Tomorrow&apos;s forecast &quot;good&quot;</title><link>https://news.example.org/tomorrow</link><description>It&#39;ll be &#x27;sunny&#x27; &amp; warm.</description></item>",
  "<item><title>Bad protocol</title><link>javascript:alert(1)</link><description>evil</description></item>",
  "<item><title>Unsupported scheme</title><link>ftp://files.example.com/x</link><description>file</description></item>",
  "<item><title>Missing description</title><link>https://example.com/no-desc</link></item>",
  "<item><title>第三条</title><link>https://third.example.com/</link><description>三</description></item>",
  "<item><title>第四条</title><link>https://fourth.example.net/</link><description>四</description></item>",
  "<item><title>第五条</title><link>https://fifth.example.info/</link><description>五</description></item>",
  "<item><title>第六条</title><link>https://sixth.example.com/</link><description>六</description></item>",
  "<item><title>第七条</title><link>https://seventh.example.com/</link><description>七</description></item>",
  "</channel></rss>",
].join("");
