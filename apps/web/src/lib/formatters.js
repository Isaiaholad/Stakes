import { zeroAddress } from 'viem';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function formatToken(value, symbol = 'USDC') {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 6
  })} ${symbol}`;
}

export function formatRelative(value, referenceTime = Date.now()) {
  return dayjs(value).from(dayjs(referenceTime));
}

export function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString();
}

export function formatCountdown(targetTimestamp, referenceTime = Date.now()) {
  if (!targetTimestamp) {
    return 'No timer';
  }

  const diff = new Date(targetTimestamp).getTime() - referenceTime;
  if (diff <= 0) {
    return 'Expired';
  }

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return `${hours}h ${minutes}m`;
}

export function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  if (!seconds || seconds <= 0) {
    return 'No duration';
  }

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) {
    return `${hours}h ${minutes}m`;
  }

  if (hours) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

export function shortenAddress(value) {
  if (!value || value === zeroAddress) {
    return 'Open';
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
