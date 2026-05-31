#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(admin, &10_000);
    token_id.address()
}

#[test]
fn test_profile() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    client.set_profile(
        &user,
        &String::from_str(&env, "alice"),
        &user.clone(),
    );
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "alice"));
}

#[test]
fn test_follow() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.follow(&alice, &bob);
    let following = client.get_following(&alice);
    assert_eq!(following.len(), 1);
    assert_eq!(following.get(0).unwrap(), bob);
}

#[test]
fn test_post_and_tip() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);
    let tipper = Address::generate(&env);
    let token = setup_token(&env, &tipper);

    let post_id = client.create_post(&author, &String::from_str(&env, "Hello Linkora!"));
    assert_eq!(post_id, 1);

    client.tip(&tipper, &post_id, &token, &500);

    let post = client.get_post(&post_id).unwrap();
    assert_eq!(post.tip_total, 500);
    assert_eq!(TokenClient::new(&env, &token).balance(&author), 500);
}

#[test]
fn test_pool_deposit_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let token = setup_token(&env, &user);
    let pool_id = symbol_short!("community");

    client.pool_deposit(&user, &pool_id, &token, &1_000);
    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.balance, 1_000);

    client.pool_withdraw(&user, &pool_id, &200);
    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.balance, 800);
    assert_eq!(TokenClient::new(&env, &token).balance(&user), 9_200);
}

#[test]
fn test_create_pool_unique_admins_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let token = setup_token(&env, &creator);
    let pool_id = symbol_short!("mypool");

    let mut admins = soroban_sdk::Vec::new(&env);
    admins.push_back(admin1);
    admins.push_back(admin2);
    admins.push_back(admin3);

    // Should succeed — no duplicates
    client.create_pool(&creator, &pool_id, &token, &admins, &2u32);

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.balance, 0);
    assert_eq!(pool.threshold, 2);
    assert_eq!(pool.admins.len(), 3);
}

#[test]
#[should_panic(expected = "duplicate admin in initial_admins")]
fn test_create_pool_duplicate_admins_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let token = setup_token(&env, &creator);
    let pool_id = symbol_short!("badpool");

    // admin1 appears twice — must panic
    let mut admins = soroban_sdk::Vec::new(&env);
    admins.push_back(admin1.clone());
    admins.push_back(admin1.clone());

    client.create_pool(&creator, &pool_id, &token, &admins, &1u32);
}
