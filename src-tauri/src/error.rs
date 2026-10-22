use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub status: u16,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn new(status: u16, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        status: u16,
        code: impl Into<String>,
        message: impl Into<String>,
        details: Value,
    ) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
            details: Some(details),
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "status": self.status,
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        })
    }
}
