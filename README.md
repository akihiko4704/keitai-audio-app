# 文庫 AudioBook Player

スマートフォンのブラウザーからJellyfinまたはWebDAV上のオーディオブックを探して、ファイルを端末へダウンロードせずにストリーミング再生できるクライアント側プレーヤーです。端末から選んだ音源の再生も利用できます。

## Jellyfin接続

1. アプリとJellyfinをブラウザーから到達できるURLで公開します。JellyfinがHTTPなら、アプリもHTTPで公開して`http://`のURLから開いてください。HTTPSで開いたページからHTTPのJellyfinへはブラウザーが接続をブロックします。JellyfinがHTTPSなら、アプリもHTTPSで開けます。
2. JellyfinサーバーURL、ユーザー名、パスワードを入力して接続します。ライブラリやフォルダーをたどり、音源を選ぶと再生リストへ追加して再生します。
3. 音声はJellyfinの`/Audio/{itemId}/stream`エンドポイントから`<audio>`プレーヤーへ直接ストリーミングします。ダウンロード用エンドポイントは使用しません。再生位置の移動にはJellyfin側のRangeリクエスト対応が必要です。

Jellyfinの管理画面で、アプリの公開元オリジン（例: `http://books.example.com:8080`）をCORS許可オリジンに追加してください。ログインには`POST`と`Content-Type`、`X-Emby-Authorization`ヘッダーを使います。HTTP接続ではログイン情報や音声データが暗号化されません。信頼できるローカルネットワーク内でのみ使用してください。

ユーザー名とパスワードはログイン時だけ送信します。アクセストークンは接続中のメモリーでAPI／ストリーム要求に使用し、ブラウザーの保存領域には書き込みません。ストリームURLにはJellyfinの`api_key`を含むため、JellyfinやプロキシのアクセスログにはURLが記録される場合があります。切断またはページを閉じるとアプリが保持する認証情報は破棄されます。再生リストにはJellyfinサーバーURL、ユーザーID、項目IDのみを保存するため、保存した音源の再生にはJellyfinへの再接続が必要です。再生形式はブラウザーが対応する音声形式に限られます。

## WebDAV接続

1. アプリをHTTPSで公開し、スマートフォンのブラウザーで開きます。`localhost`以外ではService Workerを使うためHTTPSが必要です。HTTPで開いた場合、Jellyfin再生は利用できますが、Service Workerを使うWebDAVストリーミング再生は利用できません。
2. WebDAVフォルダーURL、ユーザー名、パスワードを入力して接続します。認証方式はBasic認証です。
3. フォルダーをたどり、音源を選ぶと再生リストへ追加してストリーミング再生します。対応形式はブラウザーが再生できる形式に限られます。

WebDAVサーバーは、アプリの公開元オリジンからのCORSアクセスを許可してください。`OPTIONS`プリフライトに応答し、`PROPFIND`、`GET`、`HEAD`、`Authorization`、`Depth`、`Content-Type`、`Range`、`If-Range`、`If-None-Match`、`If-Modified-Since`を許可する必要があります。Range再生の応答では`Accept-Ranges`、`Content-Length`、`Content-Range`、`Content-Type`、`ETag`、`Last-Modified`を公開してください。公開元オリジンはアプリのURLに限定してください。

WebDAVの認証情報はページを開いている間だけメモリー上に保持し、切断またはページを閉じると破棄します。再生リストには音源名とURLのみがブラウザー内に保存されます。保存済みのWebDAV音源を再生するには、同じWebDAVフォルダーへ再接続してください。アプリとWebDAVの両方をHTTPSで公開してください。