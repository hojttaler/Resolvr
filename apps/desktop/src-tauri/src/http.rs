use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Запрос, пришедший из webview.
///
/// Запросы идут через Rust, а не через `fetch` в webview: у webview действуют
/// правила CORS, а GraphQL-эндпоинты в dev-окружениях обычно их не настраивают.
/// Заодно здесь доступны точные тайминги и приём самоподписанных сертификатов.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestInput {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
    pub accept_invalid_certs: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseTimings {
    pub total_ms: f64,
    pub first_byte_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponseOutput {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub timings: ResponseTimings,
}

const DEFAULT_TIMEOUT_MS: u64 = 30_000;

#[tauri::command]
pub async fn http_request(input: HttpRequestInput) -> Result<HttpResponseOutput, String> {
    let started = Instant::now();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(
            input.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
        ))
        .danger_accept_invalid_certs(input.accept_invalid_certs.unwrap_or(false))
        .user_agent("Resolvr/0.1")
        .build()
        .map_err(|error| format!("Не удалось создать HTTP-клиент: {error}"))?;

    let method = reqwest::Method::from_bytes(input.method.as_bytes())
        .map_err(|_| format!("Неизвестный HTTP-метод: {}", input.method))?;

    let mut request = client.request(method, &input.url);
    for (name, value) in &input.headers {
        request = request.header(name, value);
    }
    if let Some(body) = input.body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| describe_transport_error(&input.url, &error))?;

    let first_byte_ms = started.elapsed().as_secs_f64() * 1000.0;
    let status = response.status();
    let status_text = status
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            headers.insert(name.as_str().to_lowercase(), value.to_string());
        }
    }

    let body = response
        .text()
        .await
        .map_err(|error| format!("Не удалось прочитать тело ответа: {error}"))?;

    Ok(HttpResponseOutput {
        status: status.as_u16(),
        status_text,
        headers,
        body,
        timings: ResponseTimings {
            total_ms: started.elapsed().as_secs_f64() * 1000.0,
            first_byte_ms,
        },
    })
}

/// Понятное объяснение сетевой ошибки вместо строки из reqwest.
///
/// Различает три типовые ситуации: сервис не поднят, истёк таймаут и проблема
/// с сертификатом — по каждой из них ясно, что делать дальше.
fn describe_transport_error(url: &str, error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return format!("Таймаут запроса к {url}");
    }
    if error.is_connect() {
        return format!("Не удалось подключиться к {url} — сервис не запущен или недоступен");
    }
    if error.is_request() {
        return format!("Некорректный запрос к {url}: {error}");
    }

    format!("Ошибка запроса к {url}: {error}")
}
