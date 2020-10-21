# Strava Heatmap Proxy

This is a HTTP proxt to access high-zoom Strava heatmap without requiring user to authorize on Strava.

## Environment variables

- `SP_EMAIL` - Strava login e-mail
- `SP_PASSWORD` - Strava login password
- `SP_PORT` - Proxy port (defalt 8080)

## Nginx configuration

`/etc/nginx/conf.d/proxy-cache.conf`:

```nginx
proxy_cache_path /fm/sdata/nginx-proxy-cache/strava levels=1:2 keys_zone=STRAVA:10m inactive=60d max_size=100g use_temp_path=off;
```

`/etc/nginx/sites-available/strava-heatmap.tiles.freemap.sk`:

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name strava-heatmap.tiles.freemap.sk;

  location / {
    proxy_pass http://localhost:8080;
    proxy_cache STRAVA;
    proxy_ignore_headers Cache-Control;
    proxy_cache_valid 200 404 60d;
    proxy_cache_use_stale error timeout invalid_header updating http_500 http_502 http_503 http_504;
    proxy_intercept_errors on;
  }

  error_page 404 =200 @error_page;

  location @error_page {
    root       /var/www/html/;
    rewrite ^  /blank256.png;
    break;
  }
}
```
