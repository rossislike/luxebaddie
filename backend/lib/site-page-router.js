/**
 * CloudFront Function, run on every request before the cache is consulted.
 *
 * Each static site (storefront, back office) is exported as one file per
 * page (/shop.html, /products/some-wig.html) but people visit clean addresses
 * (/shop, /products/some-wig). This maps the address to the file. Addresses that
 * already name a file (anything with an extension) pass through untouched, as
 * does the home page, which the distribution's default root object serves.
 *
 * Runs in the CloudFront Functions runtime, not Node: no imports, no exports.
 */
function handler(event) {
  var request = event.request;
  request.uri = pageFile(request.uri);
  return request;
}

function pageFile(uri) {
  if (uri === "/") return uri;
  var path = uri.endsWith("/") ? uri.slice(0, -1) : uri;
  var lastSegment = path.slice(path.lastIndexOf("/") + 1);
  return lastSegment.includes(".") ? path : path + ".html";
}
