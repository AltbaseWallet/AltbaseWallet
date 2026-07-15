use js_sys::{Array, BigInt, Object, Reflect};
use kaspa_addresses::{Address, Prefix, Version};
use kaspa_bip32::secp256k1;
use kaspa_bip32::{ChildNumber, DerivationPath, ExtendedPrivateKey, Language, Mnemonic, SecretKey};
use kaspa_consensus_core::{
    config::params::MAINNET_PARAMS,
    mass::{UtxoCell, calc_storage_mass},
    sign::sign_with_multiple_v2,
    subnets::{SUBNETWORK_ID_NATIVE, SUBNETWORK_ID_SIZE},
    tx::{
        ScriptPublicKey, SignableTransaction, Transaction, TransactionId, TransactionInput,
        TransactionOutpoint, TransactionOutput, UtxoEntry,
    },
};
use kaspa_txscript::pay_to_address_script;
use kaspa_utils::hex::ToHex;
use serde_json::json;
use std::{cell::RefCell, str::FromStr};
use wasm_bindgen::prelude::*;
use zeroize::Zeroize;

const HASH_SIZE: u64 = 32;
const SIGNATURE_SIZE: u64 = 66;
const MAXIMUM_STANDARD_TRANSACTION_MASS: u64 = 100_000;
const MINIMUM_RELAY_TRANSACTION_FEE: u64 = 100_000;

fn js_error(error: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&error.to_string()).into()
}

fn property(object: &Object, name: &str) -> Result<JsValue, JsValue> {
    Reflect::get(object, &JsValue::from_str(name))
}

fn string_property(object: &Object, name: &str) -> Result<String, JsValue> {
    property(object, name)?
        .as_string()
        .ok_or_else(|| js_error(format!("{name} must be a string")))
}

fn u64_value(value: JsValue, name: &str) -> Result<u64, JsValue> {
    if let Some(number) = value.as_f64() {
        if number.is_finite() && number >= 0.0 && number.fract() == 0.0 && number <= u64::MAX as f64
        {
            return Ok(number as u64);
        }
    }
    if value.is_bigint() {
        let text = BigInt::from(value)
            .to_string(10)
            .map_err(|_| js_error(format!("{name} is not an integer")))?;
        return text
            .as_string()
            .ok_or_else(|| js_error(format!("{name} is not an integer")))?
            .parse()
            .map_err(js_error);
    }
    if let Some(text) = value.as_string() {
        return text.parse().map_err(js_error);
    }
    Err(js_error(format!("{name} must be an unsigned integer")))
}

#[derive(Clone)]
struct Spendable {
    outpoint: TransactionOutpoint,
    entry: UtxoEntry,
}

fn parse_utxo(value: JsValue) -> Result<Spendable, JsValue> {
    let object = Object::from(value);
    let outpoint = Object::from(property(&object, "outpoint")?);
    let transaction_id =
        TransactionId::from_str(&string_property(&outpoint, "transactionId")?).map_err(js_error)?;
    let index = u64_value(property(&outpoint, "index")?, "outpoint.index")?;
    let script_public_key = Object::from(property(&object, "scriptPublicKey")?);
    let version = u64_value(
        property(&script_public_key, "version")?,
        "scriptPublicKey.version",
    )?;
    let script = hex::decode(string_property(&script_public_key, "script")?).map_err(js_error)?;
    let amount = u64_value(property(&object, "amount")?, "amount")?;
    let block_daa_score = u64_value(property(&object, "blockDaaScore")?, "blockDaaScore")?;
    let is_coinbase = property(&object, "isCoinbase")?.as_bool().unwrap_or(false);
    if amount == 0 {
        return Err(js_error("Kaspa UTXO amount must be greater than zero"));
    }

    Ok(Spendable {
        outpoint: TransactionOutpoint::new(transaction_id, u32::try_from(index).map_err(js_error)?),
        entry: UtxoEntry::new(
            amount,
            ScriptPublicKey::from_vec(u16::try_from(version).map_err(js_error)?, script),
            block_daa_score,
            is_coinbase,
            None,
        ),
    })
}

fn blank_transaction_serialized_byte_size() -> u64 {
    2 + 8 + 8 + 8 + SUBNETWORK_ID_SIZE as u64 + 8 + HASH_SIZE + 8
}

fn transaction_input_serialized_byte_size(input: &TransactionInput) -> u64 {
    HASH_SIZE + 4 + 8 + input.signature_script.len() as u64 + 8
}

fn transaction_output_serialized_byte_size(output: &TransactionOutput) -> u64 {
    8 + 2 + 8 + output.script_public_key.script().len() as u64
}

fn unsigned_compute_mass(transaction: &Transaction) -> u64 {
    let params = &MAINNET_PARAMS;
    let blank = blank_transaction_serialized_byte_size() * params.mass_per_tx_byte;
    let payload = transaction.payload.len() as u64 * params.mass_per_tx_byte.max(2);
    let outputs = transaction
        .outputs
        .iter()
        .map(|output| {
            params.mass_per_script_pub_key_byte
                * (2 + output.script_public_key.script().len() as u64)
                + transaction_output_serialized_byte_size(output) * params.mass_per_tx_byte
        })
        .sum::<u64>();
    let inputs = transaction
        .inputs
        .iter()
        .map(|input| {
            input.compute_commit.sig_op_count().unwrap_or_default() as u64 * params.mass_per_sig_op
                + transaction_input_serialized_byte_size(input) * params.mass_per_tx_byte
        })
        .sum::<u64>();
    blank
        + payload
        + outputs
        + inputs
        + SIGNATURE_SIZE * params.mass_per_tx_byte * transaction.inputs.len() as u64
}

fn mass_components(
    transaction: &Transaction,
    entries: &[UtxoEntry],
) -> Result<(u64, u64), JsValue> {
    let compute = unsigned_compute_mass(transaction);
    let storage = calc_storage_mass(
        false,
        entries.iter().map(UtxoCell::from),
        transaction.outputs.iter().map(UtxoCell::from),
        MAINNET_PARAMS.storage_mass_parameter,
    )
    .ok_or_else(|| js_error("Kaspa storage mass calculation failed"))?;
    Ok((compute, compute.max(storage)))
}

fn minimum_relay_fee(mass: u64) -> u64 {
    let fee = mass.saturating_mul(MINIMUM_RELAY_TRANSACTION_FEE) / 1_000;
    if fee == 0 {
        MINIMUM_RELAY_TRANSACTION_FEE
    } else {
        fee
    }
}

fn fee_for_mass(
    compute_mass: u64,
    overall_mass: u64,
    fee_rate: f64,
    priority_fee: u64,
) -> Result<u64, JsValue> {
    let rate_fee = (overall_mass as f64 * fee_rate).ceil();
    if !rate_fee.is_finite() || rate_fee < 0.0 || rate_fee > u64::MAX as f64 {
        return Err(js_error("Kaspa fee is outside the supported range"));
    }
    (rate_fee as u64)
        .max(minimum_relay_fee(compute_mass))
        .checked_add(priority_fee)
        .ok_or_else(|| js_error("Kaspa fee overflow"))
}

fn is_dust(output: &TransactionOutput) -> bool {
    if output.script_public_key.script().len() < 33 {
        return true;
    }
    let total_serialized_size = transaction_output_serialized_byte_size(output) + 148;
    match output.value.checked_mul(1_000) {
        Some(value) => value / (3 * total_serialized_size) < MINIMUM_RELAY_TRANSACTION_FEE,
        None => {
            output.value as u128 * 1_000 / (3 * total_serialized_size as u128)
                < MINIMUM_RELAY_TRANSACTION_FEE as u128
        }
    }
}

fn make_transaction(selected: &[Spendable], outputs: Vec<TransactionOutput>) -> Transaction {
    let inputs = selected
        .iter()
        .map(|utxo| TransactionInput::new(utxo.outpoint, vec![], 0, 1))
        .collect();
    Transaction::new(0, inputs, outputs, 0, SUBNETWORK_ID_NATIVE, 0, vec![])
}

type TransactionCandidate = (Transaction, Vec<UtxoEntry>, u64);

enum CandidateAttempt {
    NeedMoreInputs,
    StorageMassTooHigh,
    Ready(TransactionCandidate),
}

fn standard_mass_error(input_count: usize) -> JsValue {
    if input_count <= 1 {
        js_error("Kaspa amount is too small for the selected UTXO; increase the amount")
    } else {
        js_error("Kaspa transaction has too many UTXOs; consolidate the wallet before sending")
    }
}

fn finalize_candidate(
    selected: &[Spendable],
    payment_outputs: &[TransactionOutput],
    payment_value: u64,
    selected_value: u64,
    change_script: &ScriptPublicKey,
    fee_rate: f64,
    priority_fee: u64,
) -> Result<CandidateAttempt, JsValue> {
    if selected_value < payment_value {
        return Ok(CandidateAttempt::NeedMoreInputs);
    }
    let entries = selected
        .iter()
        .map(|utxo| utxo.entry.clone())
        .collect::<Vec<_>>();
    let available_for_fee = selected_value - payment_value;
    let no_change = make_transaction(selected, payment_outputs.to_vec());
    let (no_change_compute_mass, no_change_mass) = mass_components(&no_change, &entries)?;
    if no_change_mass > MAXIMUM_STANDARD_TRANSACTION_MASS {
        return Ok(CandidateAttempt::StorageMassTooHigh);
    }
    let no_change_fee = fee_for_mass(
        no_change_compute_mass,
        no_change_mass,
        fee_rate,
        priority_fee,
    )?;
    if available_for_fee < no_change_fee {
        return Ok(CandidateAttempt::NeedMoreInputs);
    }

    let gross_change_output = TransactionOutput::new(available_for_fee, change_script.clone());
    if available_for_fee == 0 || is_dust(&gross_change_output) {
        no_change.set_storage_mass(no_change_mass);
        return Ok(CandidateAttempt::Ready((
            no_change,
            entries,
            available_for_fee,
        )));
    }

    let mut estimated_outputs = payment_outputs.to_vec();
    estimated_outputs.push(gross_change_output);
    let estimated_with_change = make_transaction(selected, estimated_outputs);
    let (estimated_compute_mass, estimated_mass) =
        mass_components(&estimated_with_change, &entries)?;
    if estimated_mass > MAXIMUM_STANDARD_TRANSACTION_MASS {
        return Ok(CandidateAttempt::StorageMassTooHigh);
    }
    let required_fee = fee_for_mass(
        estimated_compute_mass,
        estimated_mass,
        fee_rate,
        priority_fee,
    )?;
    if required_fee.saturating_sub(no_change_fee) > available_for_fee {
        no_change.set_storage_mass(no_change_mass);
        return Ok(CandidateAttempt::Ready((
            no_change,
            entries,
            available_for_fee,
        )));
    }
    if required_fee > available_for_fee {
        return Ok(CandidateAttempt::NeedMoreInputs);
    }

    let change_value = available_for_fee - required_fee;
    let change_output = TransactionOutput::new(change_value, change_script.clone());
    if change_value == 0 || is_dust(&change_output) {
        no_change.set_storage_mass(no_change_mass);
        return Ok(CandidateAttempt::Ready((
            no_change,
            entries,
            available_for_fee,
        )));
    }
    let mut outputs = payment_outputs.to_vec();
    outputs.push(change_output);
    let with_change = make_transaction(selected, outputs);
    let (_, final_mass) = mass_components(&with_change, &entries)?;
    if final_mass > MAXIMUM_STANDARD_TRANSACTION_MASS {
        return Ok(CandidateAttempt::StorageMassTooHigh);
    }
    with_change.set_storage_mass(final_mass);
    Ok(CandidateAttempt::Ready((
        with_change,
        entries,
        required_fee,
    )))
}

fn finalize_sweep(
    selected: &[Spendable],
    payment_script: &ScriptPublicKey,
    fee_rate: f64,
    priority_fee: u64,
) -> Result<TransactionCandidate, JsValue> {
    let selected_value = selected.iter().try_fold(0u64, |sum, utxo| {
        sum.checked_add(utxo.entry.amount)
            .ok_or_else(|| js_error("Kaspa UTXO amount overflow"))
    })?;
    let entries = selected
        .iter()
        .map(|utxo| utxo.entry.clone())
        .collect::<Vec<_>>();
    let mut fee = 0u64;

    for _ in 0..12 {
        let payment_value = selected_value
            .checked_sub(fee)
            .filter(|value| *value > 0)
            .ok_or_else(|| js_error("Kaspa balance is too small to cover the network fee"))?;
        let payment_output = TransactionOutput::new(payment_value, payment_script.clone());
        if is_dust(&payment_output) {
            return Err(js_error(
                "Kaspa balance is too small to cover the network fee",
            ));
        }
        let transaction = make_transaction(selected, vec![payment_output]);
        let (compute_mass, mass) = mass_components(&transaction, &entries)?;
        if mass > MAXIMUM_STANDARD_TRANSACTION_MASS {
            return Err(standard_mass_error(selected.len()));
        }
        let required_fee = fee_for_mass(compute_mass, mass, fee_rate, priority_fee)?;
        if required_fee == fee {
            transaction.set_storage_mass(mass);
            return Ok((transaction, entries, fee));
        }
        fee = required_fee;
    }

    Err(js_error("Kaspa sweep fee calculation did not converge"))
}

#[wasm_bindgen(js_name = deriveKaspaWallet)]
pub fn derive_kaspa_wallet(phrase: String) -> Result<JsValue, JsValue> {
    let mnemonic = Mnemonic::new(phrase, Language::English).map_err(js_error)?;
    let master = ExtendedPrivateKey::<SecretKey>::new(mnemonic.to_seed("")).map_err(js_error)?;
    let path = DerivationPath::from_str("m/44'/111111'/0'/0").map_err(js_error)?;
    let receive = master
        .derive_path(&path)
        .map_err(js_error)?
        .derive_child(ChildNumber::new(0, false).map_err(js_error)?)
        .map_err(js_error)?;
    let private_key = receive.private_key();
    let public_key = secp256k1::PublicKey::from_secret_key_global(private_key);
    let (x_only, _) = public_key.x_only_public_key();
    let address = Address::new(Prefix::Mainnet, Version::PubKey, &x_only.serialize());

    let result = Object::new();
    Reflect::set(&result, &"address".into(), &address.to_string().into())?;
    Reflect::set(
        &result,
        &"privateKey".into(),
        &private_key.secret_bytes().to_vec().to_hex().into(),
    )?;
    Ok(result.into())
}

#[wasm_bindgen(js_name = validateKaspaAddress)]
pub fn validate_kaspa_address(address: String) -> bool {
    Address::try_from(address)
        .map(|value| value.prefix == Prefix::Mainnet)
        .unwrap_or(false)
}

#[wasm_bindgen]
pub struct PendingTransaction {
    transaction: RefCell<Transaction>,
    entries: Vec<UtxoEntry>,
    fee: u64,
}

#[wasm_bindgen]
impl PendingTransaction {
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.transaction.borrow().id().to_string()
    }

    #[wasm_bindgen(getter, js_name = feeAmount)]
    pub fn fee_amount(&self) -> BigInt {
        BigInt::from(self.fee)
    }

    pub fn sign(&self, private_keys: Array) -> Result<(), JsValue> {
        let mut keys = private_keys
            .iter()
            .map(|value| {
                let text = value
                    .as_string()
                    .ok_or_else(|| js_error("private key must be a hex string"))?;
                let bytes = hex::decode(text).map_err(js_error)?;
                <[u8; 32]>::try_from(bytes)
                    .map_err(|_| js_error("private key must contain 32 bytes"))
            })
            .collect::<Result<Vec<_>, JsValue>>()?;
        let signable = SignableTransaction::with_entries(
            self.transaction.borrow().clone(),
            self.entries.clone(),
        );
        let signed = sign_with_multiple_v2(signable, &keys)
            .fully_signed()
            .map_err(|_| {
                js_error(
                    "Kaspa transaction signing failed: the private key does not match every input",
                )
            });
        keys.zeroize();
        *self.transaction.borrow_mut() = signed?.tx;
        Ok(())
    }

    #[wasm_bindgen(js_name = serializeToSafeJSON)]
    pub fn serialize_to_safe_json(&self) -> Result<String, JsValue> {
        let transaction = self.transaction.borrow();
        if transaction
            .inputs
            .iter()
            .any(|input| input.signature_script.is_empty())
        {
            return Err(js_error(
                "Kaspa transaction must be signed before serialization",
            ));
        }
        let inputs = transaction
            .inputs
            .iter()
            .map(|input| {
                json!({
                    "previousOutpoint": {
                        "transactionId": input.previous_outpoint.transaction_id.to_string(),
                        "index": input.previous_outpoint.index,
                    },
                    "signatureScript": input.signature_script.to_hex(),
                    "sequence": input.sequence,
                    "sigOpCount": input.compute_commit.sig_op_count().unwrap_or_default(),
                })
            })
            .collect::<Vec<_>>();
        let outputs = transaction
            .outputs
            .iter()
            .map(|output| {
                json!({
                    "amount": output.value,
                    "scriptPublicKey": {
                        "version": output.script_public_key.version(),
                        "scriptPublicKey": output.script_public_key.script().to_hex(),
                    },
                })
            })
            .collect::<Vec<_>>();
        serde_json::to_string(&json!({
            "version": transaction.version,
            "inputs": inputs,
            "outputs": outputs,
            "lockTime": transaction.lock_time,
            "subnetworkId": transaction.subnetwork_id.to_string(),
        }))
        .map_err(js_error)
    }
}

#[wasm_bindgen(js_name = createTransactions)]
pub fn create_transactions(settings: JsValue) -> Result<JsValue, JsValue> {
    let object = Object::from(settings);
    let network_id = string_property(&object, "networkId")?;
    if network_id != "mainnet" {
        return Err(js_error("Only the Kaspa mainnet public RPC is supported"));
    }
    let change_address =
        Address::try_from(string_property(&object, "changeAddress")?).map_err(js_error)?;
    if change_address.prefix != Prefix::Mainnet {
        return Err(js_error("changeAddress must be a Kaspa mainnet address"));
    }

    let mut entries = Array::from(&property(&object, "entries")?)
        .iter()
        .map(parse_utxo)
        .collect::<Result<Vec<_>, JsValue>>()?;
    if entries.is_empty() {
        return Err(js_error("entries must contain at least one UTXO"));
    }
    entries.sort_by(|left, right| right.entry.amount.cmp(&left.entry.amount));

    let payment_outputs = Array::from(&property(&object, "outputs")?)
        .iter()
        .map(|value| {
            let output = Object::from(value);
            let address =
                Address::try_from(string_property(&output, "address")?).map_err(js_error)?;
            if address.prefix != Prefix::Mainnet {
                return Err(js_error("payment address must be a Kaspa mainnet address"));
            }
            let amount = u64_value(property(&output, "amount")?, "output.amount")?;
            if amount == 0 {
                return Err(js_error("Kaspa payment amount must be greater than zero"));
            }
            Ok(TransactionOutput::new(
                amount,
                pay_to_address_script(&address),
            ))
        })
        .collect::<Result<Vec<_>, JsValue>>()?;
    if payment_outputs.is_empty() {
        return Err(js_error("outputs must contain at least one payment"));
    }
    let payment_value = payment_outputs
        .iter()
        .try_fold(0u64, |sum, output| sum.checked_add(output.value))
        .ok_or_else(|| js_error("Kaspa payment amount overflow"))?;
    let fee_rate = property(&object, "feeRate")?
        .as_f64()
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| js_error("feeRate must be a positive number"))?;
    let priority_fee = u64_value(property(&object, "priorityFee")?, "priorityFee")?;
    let change_script = pay_to_address_script(&change_address);

    let mut selected = Vec::new();
    let mut selected_value = 0u64;
    let mut candidate = None;
    let mut last_attempt_had_excess_storage_mass = false;
    for entry in entries {
        selected_value = selected_value
            .checked_add(entry.entry.amount)
            .ok_or_else(|| js_error("Kaspa UTXO amount overflow"))?;
        selected.push(entry);
        match finalize_candidate(
            &selected,
            &payment_outputs,
            payment_value,
            selected_value,
            &change_script,
            fee_rate,
            priority_fee,
        )? {
            CandidateAttempt::NeedMoreInputs => last_attempt_had_excess_storage_mass = false,
            CandidateAttempt::StorageMassTooHigh => last_attempt_had_excess_storage_mass = true,
            CandidateAttempt::Ready(ready) => {
                candidate = Some(ready);
                break;
            }
        }
    }
    let (transaction, entries, fee) = match candidate {
        Some(candidate) => candidate,
        None if last_attempt_had_excess_storage_mass => {
            return Err(standard_mass_error(selected.len()));
        }
        None => return Err(js_error("Kaspa balance is insufficient after network fees")),
    };
    if transaction.storage_mass() > MAXIMUM_STANDARD_TRANSACTION_MASS {
        return Err(standard_mass_error(transaction.inputs.len()));
    }

    let transactions = Array::new();
    transactions.push(&JsValue::from(PendingTransaction {
        transaction: RefCell::new(transaction),
        entries,
        fee,
    }));
    let result = Object::new();
    Reflect::set(&result, &"transactions".into(), &transactions)?;
    Ok(result.into())
}

#[wasm_bindgen(js_name = createSweepTransaction)]
pub fn create_sweep_transaction(settings: JsValue) -> Result<JsValue, JsValue> {
    let object = Object::from(settings);
    let network_id = string_property(&object, "networkId")?;
    if network_id != "mainnet" {
        return Err(js_error("Only the Kaspa mainnet public RPC is supported"));
    }
    let address = Address::try_from(string_property(&object, "address")?).map_err(js_error)?;
    if address.prefix != Prefix::Mainnet {
        return Err(js_error("address must be a Kaspa mainnet address"));
    }
    let entries = Array::from(&property(&object, "entries")?)
        .iter()
        .map(parse_utxo)
        .collect::<Result<Vec<_>, JsValue>>()?;
    if entries.is_empty() {
        return Err(js_error("entries must contain at least one UTXO"));
    }
    let fee_rate = property(&object, "feeRate")?
        .as_f64()
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| js_error("feeRate must be a positive number"))?;
    let priority_fee = u64_value(property(&object, "priorityFee")?, "priorityFee")?;
    let payment_script = pay_to_address_script(&address);
    let (transaction, entries, fee) =
        finalize_sweep(&entries, &payment_script, fee_rate, priority_fee)?;

    let transactions = Array::new();
    transactions.push(&JsValue::from(PendingTransaction {
        transaction: RefCell::new(transaction),
        entries,
        fee,
    }));
    let result = Object::new();
    Reflect::set(&result, &"transactions".into(), &transactions)?;
    Ok(result.into())
}
