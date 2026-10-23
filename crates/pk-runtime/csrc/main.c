/*
 * ProsperoKit - PS5 application entry. The kit compiles this file and links
 * libprosperokit_runtime.a; pk_main() never returns (returning from main
 * crashes the launch context).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
void pk_main(void) __attribute__((noreturn));

int main(void)
{
    pk_main();
}
