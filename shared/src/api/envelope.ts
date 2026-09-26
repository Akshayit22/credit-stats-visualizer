/**
 * Every API response is exactly one of these two shapes — never a bare value,
 * never an error without a code the client can switch on.
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorised'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'server_error';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
