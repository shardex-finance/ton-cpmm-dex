import { toNano } from '@ton/core';

export function randomIntFromInterval(min: number, max: number) {
    // min and max included
    return Math.floor(Math.random() * (max - min + 1) + min);
}

export const TestTonSwaps = [
    // { amountA: toNano('1'), amountB: toNano('10'), amountIn: BigInt(1) },
    // { amountA: toNano('1'), amountB: toNano('10'), amountIn: BigInt(10) },
    // { amountA: toNano('1'), amountB: toNano('10'), amountIn: BigInt(20) },
    // { amountA: toNano('1'), amountB: toNano('10'), amountIn: BigInt(200) },
    // { amountA: toNano('1'), amountB: toNano('10'), amountIn: BigInt(1000) },
    { amountA: toNano('1'), amountB: toNano('10'), amountIn: BigInt(2000) },
    { amountA: toNano('1'), amountB: toNano('10'), amountIn: BigInt(20000) },
    { amountA: toNano('1'), amountB: toNano('10'), amountIn: BigInt(200000) },
    { amountA: toNano('1'), amountB: toNano('10'), amountIn: toNano('1') },
    {
        amountA: toNano(randomIntFromInterval(1, 1000)),
        amountB: toNano(randomIntFromInterval(1, 1000)),
        amountIn: BigInt(randomIntFromInterval(1000, 2000000000)),
    },
    {
        amountA: toNano(randomIntFromInterval(1, 1000)),
        amountB: toNano(randomIntFromInterval(1, 1000)),
        amountIn: BigInt(randomIntFromInterval(1000, 2000000000)),
    },
    {
        amountA: toNano(randomIntFromInterval(1, 1000)),
        amountB: toNano(randomIntFromInterval(1, 1000)),
        amountIn: BigInt(randomIntFromInterval(1000, 2000000000)),
    },
    {
        amountA: toNano(randomIntFromInterval(1, 1000)),
        amountB: toNano(randomIntFromInterval(1, 1000)),
        amountIn: BigInt(randomIntFromInterval(1000, 20000000000)),
    },
    {
        amountA: toNano(randomIntFromInterval(10, 100000)),
        amountB: toNano(randomIntFromInterval(10, 100000)),
        amountIn: BigInt(randomIntFromInterval(1000, 20000000000)),
    },
    {
        amountA: toNano(randomIntFromInterval(100, 100000)),
        amountB: toNano(randomIntFromInterval(100, 100000)),
        amountIn: BigInt(randomIntFromInterval(1000000000000, 2000000000000)),
    },
    {
        amountA: toNano(randomIntFromInterval(100, 100000)),
        amountB: toNano(randomIntFromInterval(100, 100000)),
        amountIn: BigInt(randomIntFromInterval(1000000000000, 2000000000000)),
    },
    {
        amountA: toNano(randomIntFromInterval(1000000, 10000000)),
        amountB: toNano(randomIntFromInterval(1000000, 10000000)),
        amountIn: toNano(randomIntFromInterval(100000, 1000000)),
    },
];

export const TestJettonsSwaps = [
    ...TestTonSwaps,
    {
        amountA: toNano(toNano(randomIntFromInterval(1, 1000))),
        amountB: toNano(toNano(randomIntFromInterval(1, 1000))),
        amountIn: toNano(BigInt(randomIntFromInterval(1000, 2000000000))),
    },
];
