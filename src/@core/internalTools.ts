import type {CacheItemProps, CacheMeta} from "./cacheHtml/cache.ts";

export function parseCookies(headers: Headers): { [name: string]: string } {
    const cookies: { [name: string]: string } = {};
    const cookieHeader = headers.get('Cookie');
    
    if (!cookieHeader) {
        return cookies;
    }

    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        if (parts.length >= 2) {
            const name = parts[0].trim();
            cookies[name] = parts.slice(1).join('=').trim();
        }
    });

    return cookies;
}

export function readContentLength(headers: Headers): number {
    const cl = headers.get("content-length");
    if (!cl) return -1;
    return parseInt(cl);
}

const gDefaultHeadersToCache: string[] = ["content-type", "etag", "last-modified"];

export function addHeadersToCache(header: string) {
    header = header.trim().toLowerCase();
    if (!gDefaultHeadersToCache.includes(header)) gDefaultHeadersToCache.push(header);
}

export function cacheAddBrowserCacheValues(cacheItem: CacheItemProps, etag: string) {
    if (!cacheItem.headers) cacheItem.headers = {};
    cacheItem.headers["etag"] = etag;
    cacheItem.headers["last-modified-since"] = new Date().toUTCString();
}

export function cacheItemToResponse(entry: CacheItemProps) {
    if (entry.binary) {
        let headers = entry.headers;
        if (!headers) headers = {};

        if (entry.isGzipped) {
            headers["content-encoding"] = "gzip";
        }
        else {
            delete(headers["content-encoding"]);
        }

        return new Response(entry.binary.buffer, {
            status: entry.status ?? 200,
            headers: headers
        });
    }

    return new Response("", {status: entry.status, headers: entry.headers});
}

export function responseToCacheItem(url: string, response: Response, meta: CacheMeta|undefined): CacheItemProps {
    const status = response.status;

    if (!meta) meta = {};
    meta.addedDate = new Date().getTime();
    const entry: CacheItemProps = { status, url, meta: meta};

    if (status===200) {
        const headers = {};
        entry.headers = headers;
        gDefaultHeadersToCache.forEach(header => addHeaderIfExist(headers, header, response.headers));
    }

    if ((status>=300)&&(status<400)) {
        entry.headers = {};
        addHeaderIfExist(entry.headers!, "Location", response.headers);
    }

    return entry;
}

export function addHeaderIfExist(headers: {[key: string]: string}, headerName: string, source: Headers) {
    const v = source.get(headerName);
    if (v!==null) headers[headerName] = v;
}

export function makeIterable<T>(iterator: Iterator<T>): Iterable<T> {
    return {
        [Symbol.iterator]() {
            return iterator;
        }
    };
}