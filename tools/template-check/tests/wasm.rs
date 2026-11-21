use std::path::Path;

use tari_engine::wasm::WasmModule;
use tari_template_test_tooling::compile::compile_template;

#[test]
fn builds_valid_ootle_wasm_with_expected_entry_points() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let wasm = compile_template(root, &[]).expect("compile escrow template");
    let loaded = WasmModule::validate_and_load(wasm.code()).expect("validate and load escrow");
    let abi = loaded.template_def();
    assert_eq!(abi.template_name(), "MilestoneEscrow");
    let expected = [
        "create",
        "fund",
        "submit",
        "approve",
        "dispute",
        "resolve",
        "claim_refund",
        "status",
        "reference",
        "locked_balance",
    ];
    assert_eq!(abi.functions().len(), expected.len());
    for method in expected {
        assert!(abi.get_function(method).is_some(), "missing {method}");
    }
}
