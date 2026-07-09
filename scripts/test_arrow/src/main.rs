use arrow::ipc::writer::{StreamWriter, IpcWriteOptions};
use arrow::datatypes::{Schema, Field, DataType};
use std::sync::Arc;

fn main() {
    let schema = Arc::new(Schema::new(vec![
        Field::new("f", DataType::Int32, true),
    ]));
    let mut dummy_sink = Vec::new();
    let _writer = StreamWriter::try_new_with_options(&mut dummy_sink, &schema, IpcWriteOptions::default()).unwrap();
    println!("dummy_sink size: {}", dummy_sink.len());
}
