module.exports = async function (mullion, params) {
  const runCount = (await mullion.storage.get('runCount', 0)) + 1;
  await mullion.storage.set('runCount', runCount);

  const cookies = await mullion.cookies.getAll();
  const heading = await mullion.inject.script(
    'return document.querySelector("h1")?.textContent || "";'
  );

  let pageTitle = null;
  if (params?.captureTitle !== false) {
    pageTitle = await mullion.page.title();
  }

  const extraPage = await mullion.tabs.create('https://example.com/');
  const extraTitle = await mullion.tabs.evaluate(extraPage, () => document.title);
  await mullion.tabs.close(extraPage);

  return {
    success: true,
    heading,
    pageTitle,
    extraTitle,
    runCount,
    cookieCount: cookies.length,
    params
  };
};
