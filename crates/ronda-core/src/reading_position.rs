use crate::TranscriptSnapshot;
use crate::{ImageAttachment, MessageKind, Role, ToolCall, TranscriptMessage};
use base64::{engine::general_purpose::STANDARD, read::DecoderReader};
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};

const MESSAGE_DOMAIN: &[u8] = b"ronda:transcript-message:v1\0";
const SESSION_DOMAIN: &[u8] = b"ronda:session-key:v1\0";

fn push_bytes(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}

fn push_str(hash: &mut Sha256, value: &str) {
    push_bytes(hash, value.as_bytes());
}

fn push_option_str(hash: &mut Sha256, value: Option<&str>) {
    match value {
        Some(value) => {
            hash.update([1]);
            push_str(hash, value);
        }
        None => hash.update([0]),
    }
}

fn push_option_i64(hash: &mut Sha256, value: Option<i64>) {
    match value {
        Some(value) => {
            hash.update([1]);
            hash.update(value.to_be_bytes());
        }
        None => hash.update([0]),
    }
}

fn push_tool(hash: &mut Sha256, tool: &ToolCall) {
    push_str(hash, &tool.id);
    push_str(hash, &tool.name);
    push_option_str(hash, tool.input.as_deref());
    push_option_str(hash, tool.output.as_deref());
    hash.update([u8::from(tool.is_error)]);
}

fn push_image(hash: &mut Sha256, image: &ImageAttachment) {
    push_str(hash, &image.media_type);
    let mut decoder = DecoderReader::new(Cursor::new(image.data_base64.as_bytes()), &STANDARD);
    let mut image_hash = Sha256::new();
    let mut buffer = [0u8; 16 * 1024];
    let valid = loop {
        match decoder.read(&mut buffer) {
            Ok(0) => break true,
            Ok(read) => image_hash.update(&buffer[..read]),
            Err(_) => break false,
        }
    };
    if valid {
        hash.update([1]);
        hash.update(image_hash.finalize());
    } else {
        // Corrupt attachments remain hashable without making transcript display fail.
        hash.update([0]);
        push_bytes(hash, image.data_base64.as_bytes());
    }
}

pub fn session_key_fingerprint(key: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(SESSION_DOMAIN);
    push_str(&mut hash, key);
    format!("{:x}", hash.finalize())
}

pub fn message_fingerprint(message: &TranscriptMessage) -> String {
    let mut hash = Sha256::new();
    hash.update(MESSAGE_DOMAIN);
    hash.update([match message.role {
        Role::User => 0,
        Role::Assistant => 1,
        Role::System => 2,
    }]);
    hash.update([match message.kind {
        MessageKind::Text => 0,
        MessageKind::Meta => 1,
        MessageKind::CompactSummary => 2,
    }]);
    push_str(&mut hash, &message.text);
    push_option_i64(&mut hash, message.timestamp);
    push_option_str(&mut hash, message.model.as_deref());
    push_option_str(&mut hash, message.thinking.as_deref());
    hash.update((message.tool_calls.len() as u64).to_be_bytes());
    for tool in &message.tool_calls {
        push_tool(&mut hash, tool);
    }
    hash.update((message.images.len() as u64).to_be_bytes());
    for image in &message.images {
        push_image(&mut hash, image);
    }
    format!("{:x}", hash.finalize())
}

pub fn snapshot_for_session(key: &str, messages: Vec<TranscriptMessage>) -> TranscriptSnapshot {
    let fingerprints = messages.iter().map(message_fingerprint).collect();
    TranscriptSnapshot {
        session_key_hash: session_key_fingerprint(key),
        messages,
        fingerprints,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn message() -> TranscriptMessage {
        TranscriptMessage {
            seq: 0,
            role: Role::Assistant,
            kind: MessageKind::Text,
            text: "hello".into(),
            timestamp: Some(1),
            model: Some("model".into()),
            thinking: Some("thought".into()),
            tool_calls: vec![ToolCall {
                id: "tool-id".into(),
                name: "Read".into(),
                input: Some("file".into()),
                output: Some("contents".into()),
                is_error: false,
            }],
            images: vec![
                ImageAttachment {
                    media_type: "image/png".into(),
                    data_base64: "AQIDBA==".into(),
                },
                ImageAttachment {
                    media_type: "image/jpeg".into(),
                    data_base64: "BQYHCA==".into(),
                },
            ],
        }
    }

    #[test]
    fn fingerprint_excludes_only_sequence_and_hashes_every_display_field() {
        let original = message();
        let fingerprint = message_fingerprint(&original);
        let mut changed = original.clone();
        changed.seq = 42;
        assert_eq!(message_fingerprint(&changed), fingerprint);

        let mut variants = Vec::new();
        let mut value = original.clone();
        value.role = Role::User;
        variants.push(value);
        let mut value = original.clone();
        value.kind = MessageKind::Meta;
        variants.push(value);
        let mut value = original.clone();
        value.text.push('!');
        variants.push(value);
        let mut value = original.clone();
        value.timestamp = None;
        variants.push(value);
        let mut value = original.clone();
        value.model = None;
        variants.push(value);
        let mut value = original.clone();
        value.thinking = None;
        variants.push(value);
        let mut value = original.clone();
        value.tool_calls[0].id.push('!');
        variants.push(value);
        let mut value = original.clone();
        value.tool_calls[0].name.push('!');
        variants.push(value);
        let mut value = original.clone();
        value.tool_calls[0].input = None;
        variants.push(value);
        let mut value = original.clone();
        value.tool_calls[0].output = None;
        variants.push(value);
        let mut value = original.clone();
        value.tool_calls[0].is_error = true;
        variants.push(value);
        let mut value = original.clone();
        value.images[0].media_type.push_str(";x");
        variants.push(value);
        let mut value = original.clone();
        value.images[0].data_base64 = "BQYHCA==".into();
        variants.push(value);
        let mut value = original.clone();
        value.images.reverse();
        variants.push(value);
        for variant in variants {
            assert_ne!(message_fingerprint(&variant), fingerprint);
        }
    }

    #[test]
    fn malformed_image_data_is_stable_and_does_not_panic() {
        let mut value = message();
        value.images[0].data_base64 = "not valid base64!".into();
        assert_eq!(message_fingerprint(&value), message_fingerprint(&value));
    }

    #[test]
    fn session_identity_hash_scopes_hosts_and_children_without_exposing_the_key() {
        let local = session_key_fingerprint("codex:session-1");
        let host_a = session_key_fingerprint("codex:buildbox:session-1");
        let host_b = session_key_fingerprint("codex:staging:session-1");
        let child = session_key_fingerprint("codex:buildbox:agent-2");
        assert_eq!(local.len(), 64);
        assert_ne!(local, host_a);
        assert_ne!(host_a, host_b);
        assert_ne!(host_a, child);
        assert!(!host_a.contains("buildbox"));
        assert!(!child.contains("agent-2"));
    }

    #[test]
    fn streams_a_large_image_through_the_fingerprint() {
        let mut value = message();
        value.images[0].data_base64 = "AAAAAAAA".repeat(1_000_000);
        let started = Instant::now();
        let fingerprint = message_fingerprint(&value);
        eprintln!(
            "6 MiB decoded image fingerprint: {} in {:?}",
            &fingerprint[..12],
            started.elapsed()
        );
        assert_eq!(fingerprint.len(), 64);
    }
}
