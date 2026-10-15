# 文庫 AudioBook Player

スマートフォンのブラウザーからWebDAV上のオーディオブックを探して再生できる、クライアント側プレーヤーです。端末から選んだ音源の再生も引き続き利用できます。

## WebDAV接続

1. アプリをHTTPSで公開し、スマートフォンのブラウザーで開きます。`localhost`以外ではService Workerを使うためHTTPSが必要です。
2. WebDAVフォルダーURL、ユーザー名、パスワードを入力して接続します。認証方式はBasic認証です。
3. フォルダーをたどり、音源を選ぶと再生リストへ追加してストリーミング再生します。対応形式はブラウザーが再生できる形式に限られます。

WebDAVサーバーは、アプリの公開元オリジンからのCORSアクセスを許可してください。`OPTIONS`プリフライトに応答し、`PROPFIND`、`GET`、`HEAD`、`Authorization`、`Depth`、`Content-Type`、`Range`、`If-Range`、`If-None-Match`、`If-Modified-Since`を許可する必要があります。Range再生の応答では`Accept-Ranges`、`Content-Length`、`Content-Range`、`Content-Type`、`ETag`、`Last-Modified`を公開してください。公開元オリジンはアプリのURLに限定してください。

WebDAVの認証情報はページを開いている間だけメモリー上に保持し、切断またはページを閉じると破棄します。再生リストには音源名とURLのみがブラウザー内に保存されます。保存済みのWebDAV音源を再生するには、同じWebDAVフォルダーへ再接続してください。アプリとWebDAVの両方をHTTPSで公開してください。