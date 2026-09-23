use keyring::Entry;

/// Доступ к macOS Keychain.
///
/// Секреты не хранятся в файлах workspace: там лежат только ссылки
/// `keychain://workspace/environment/key`, а значения живут в системном
/// хранилище. Благодаря этому коллекции безопасно коммитить и показывать агенту.
const SERVICE_PREFIX: &str = "Resolvr";

fn service_name(workspace: &str, environment: &str) -> String {
    format!("{SERVICE_PREFIX}:{workspace}:{environment}")
}

fn entry(workspace: &str, environment: &str, key: &str) -> Result<Entry, String> {
    Entry::new(&service_name(workspace, environment), key).map_err(|error| {
        log::error!("Keychain недоступен ({workspace}/{environment}): {error}");
        format!("Не удалось обратиться к Keychain: {error}")
    })
}

/// Записывает сбой Keychain в журнал.
///
/// В запись попадают только операция, окружение, имя ключа и вид ошибки
/// `keyring`; значение секрета не логируется никогда.
fn log_failure(
    operation: &str,
    workspace: &str,
    environment: &str,
    key: &str,
    error: &keyring::Error,
) {
    log::error!("Keychain: {operation} {workspace}/{environment}/{key} — {error}");
}

#[tauri::command]
pub fn keychain_get(
    workspace: String,
    environment: String,
    key: String,
) -> Result<Option<String>, String> {
    match entry(&workspace, &environment, &key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => {
            log_failure("чтение", &workspace, &environment, &key, &error);
            Err(format!("Ошибка чтения секрета \"{key}\": {error}"))
        }
    }
}

#[tauri::command]
pub fn keychain_set(
    workspace: String,
    environment: String,
    key: String,
    value: String,
) -> Result<(), String> {
    entry(&workspace, &environment, &key)?
        .set_password(&value)
        .map_err(|error| {
            log_failure("запись", &workspace, &environment, &key, &error);
            format!("Ошибка записи секрета \"{key}\": {error}")
        })
}

#[tauri::command]
pub fn keychain_delete(workspace: String, environment: String, key: String) -> Result<(), String> {
    match entry(&workspace, &environment, &key)?.delete_credential() {
        // Удаление идемпотентно: отсутствие записи не считается ошибкой.
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => {
            log_failure("удаление", &workspace, &environment, &key, &error);
            Err(format!("Ошибка удаления секрета \"{key}\": {error}"))
        }
    }
}
